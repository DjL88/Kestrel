import { createServer } from 'node:http';
import { createApp, openApi } from './app.ts';
import { CloudDemoStudio } from './demoStudio.ts';
import { loadConfig } from './config.ts';
import { CommerceLedger } from './commerce/ledger.ts';
import { paddleProSettlement, type ProPurchaseOrder } from './commerce/proSettlement.ts';
import { paddleApi } from './commerce/paddle.ts';
import { paddleProCheckout, type StoredProOrder } from './commerce/proCheckout.ts';
import { FirestoreStore, type FirestoreLike } from './firestoreStore.ts';
import { openFirestore, openStore } from './openStore.ts';
import { buildOptionalServices } from './wiring.ts';

const config = loadConfig();
const firestore = config.store === 'firestore' ? await openFirestore(config) : undefined;
const store = firestore ? new FirestoreStore(firestore as unknown as FirestoreLike) : await openStore(config);
const commerce = firestore ? new CommerceLedger(firestore) : undefined;
// Paddle Billing (merchant of record). Secrets come from Secret Manager through Cloud Run; see infra/gcp/phase5-paddle.tf.
const paddleKey = process.env.KCP_PADDLE_API_KEY?.trim();
const paddleEnvironment = process.env.KCP_PADDLE_ENVIRONMENT?.trim() === 'production' ? 'production' : 'sandbox';
const paddlePriceId = process.env.KCP_PADDLE_PRO_PRICE_ID?.trim();
const paddleWebhookSecret = process.env.KCP_PADDLE_WEBHOOK_SECRET?.trim() || undefined;
const paddleClientToken = process.env.KCP_PADDLE_CLIENT_TOKEN?.trim();
const paddle = paddleKey ? paddleApi({ apiKey: paddleKey, environment: paddleEnvironment }) : undefined;
const paddleOrders = 'paddle_pro_orders';
const settlePaddle = firestore && commerce && paddle ? paddleProSettlement({
  findOrder: async (id) => (await firestore.collection(paddleOrders).doc(id).get()).data() as ProPurchaseOrder | undefined ?? null,
  paddle,
  commerce,
  licences: store,
}) : undefined;
// The checkout page is on the published website (the first HTTPS app origin, i.e. the Hosting site Terraform adds).
const siteUrl = process.env.KCP_PUBLIC_SITE_URL?.trim() || config.allowedOrigins.find((o) => o.startsWith('https://') && o !== 'https://tauri.localhost');
const proCheckout = firestore && paddle && settlePaddle && paddlePriceId && siteUrl ? paddleProCheckout({
  paddle,
  orders: {
    // create() refuses to overwrite: a transaction ID is bound to one account for good.
    save: async (order) => { await firestore.collection(paddleOrders).doc(order.transactionId).create(order); },
    get: async (id) => (await firestore.collection(paddleOrders).doc(id).get()).data() as StoredProOrder | undefined ?? null,
  },
  priceId: paddlePriceId,
  checkoutUrl: new URL('/pro-checkout', siteUrl).toString(),
  settle: settlePaddle,
}) : undefined;
const paddleClient = paddleClientToken ? { environment: paddleEnvironment, clientToken: paddleClientToken } as const : undefined;
const demoStudio = firestore && process.env.KCP_DEMO_PRIVATE_BUCKET && process.env.KCP_DEMO_PUBLIC_BUCKET
  ? new CloudDemoStudio(firestore, process.env.KCP_DEMO_PRIVATE_BUCKET, process.env.KCP_DEMO_PUBLIC_BUCKET) : undefined;
const optional = await buildOptionalServices({ firestore: firestore as unknown as FirestoreLike | undefined, sessionSecret: config.sessionSecret });
const app = createApp({ config, store, commerce, payments: commerce, settlePaddle, paddleWebhookSecret, paddleClient, proCheckout, pricing: commerce, demoStudio, cloud: optional.cloud, safeCopy: optional.safeCopy, collab: optional.collab, presence: optional.presence, gallery: optional.gallery, notices: optional.notices, cloudPhotos: optional.cloudPhotos, learning: optional.learning, learningWithdrawal: optional.learningWithdrawal, spend: optional.spend, mailer: optional.mailer, requireAdminSwitch: true });

if (process.argv.includes('--print-openapi')) {
  process.stdout.write(`${JSON.stringify(openApi(app.routes), null, 2)}\n`);
  process.exit(0);
}

if (config.devMode && process.env.KCP_DEV_ADMIN_EMAIL && process.env.KCP_DEV_ADMIN_PASSWORD) {
  await app.createAccount(process.env.KCP_DEV_ADMIN_EMAIL, process.env.KCP_DEV_ADMIN_PASSWORD, 'admin');
}

const server = createServer((req, res) => { void app.handle(req, res); });
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(config.port, () => {
  console.log(`Kestrel control plane on http://localhost:${config.port}${config.devMode ? ' (development mode: throwaway keys)' : ''}, storing data in ${app.store.kind === 'sqlite' ? `SQLite (${config.databasePath})` : 'Firestore'}`);
  console.log(`Pin this manifest/grant public key in the client: ${config.signingKey.keyId}=${config.signingKey.publicKeyBase64}`);
  console.log(`Optional services on: ${optional.enabled.join(', ') || 'none'}.`);
  if (!config.geminiApiKey) console.log('No AI provider key set: /v1/ai/* will answer AI_NOT_CONFIGURED.');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => { void app.store.close().finally(() => process.exit(0)); }));
}
