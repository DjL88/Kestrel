import { createServer } from 'node:http';
import { createApp, openApi } from './app.ts';
import { CloudDemoStudio } from './demoStudio.ts';
import { loadConfig } from './config.ts';
import { CommerceLedger } from './commerce/ledger.ts';
import { paddleProSettlement, type ProPurchaseOrder } from './commerce/proSettlement.ts';
import { paddleRefundRevocation } from './commerce/paddleRefunds.ts';
import { paddleApi } from './commerce/paddle.ts';
import { rotatingKeySource, secretManagerSecret } from './commerce/paddleKeyRotation.ts';
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
// The key is renewed by the kestrel-paddle-key-rotation job (infra/gcp/paddle-key-rotation.tf). When
// KCP_PADDLE_KEY_PROJECT is set the server re-reads the latest secret version every 5 minutes, so a new key takes over
// without a redeploy; the value Cloud Run injected at start-up is the fallback.
const paddleKeyProject = process.env.KCP_PADDLE_KEY_PROJECT?.trim();
const paddleApiKey = paddleKey && paddleKeyProject
  ? rotatingKeySource(secretManagerSecret({ project: paddleKeyProject, secret: process.env.KCP_PADDLE_KEY_SECRET?.trim() || 'kestrel-paddle-api-key' }).latest, paddleKey)
  : paddleKey;
const paddle = paddleApiKey ? paddleApi({ apiKey: paddleApiKey, environment: paddleEnvironment }) : undefined;
const paddleOrders = 'paddle_pro_orders';
const settlePaddle = firestore && commerce && paddle ? paddleProSettlement({
  findOrder: async (id) => (await firestore.collection(paddleOrders).doc(id).get()).data() as ProPurchaseOrder | undefined ?? null,
  paddle,
  commerce,
  licences: store,
}) : undefined;
// A full refund or chargeback of a Pro order removes Pro. Each Paddle event id is claimed once (create() refuses a second).
const revokePaddle = firestore && paddle ? paddleRefundRevocation({
  findOrder: async (id) => (await firestore.collection(paddleOrders).doc(id).get()).data() as ProPurchaseOrder | undefined ?? null,
  paddle,
  licences: store,
  events: {
    claim: async (eventId, atMs) => { try { await firestore.collection('paddle_events').doc(eventId.slice(0, 128)).create({ atMs }); return true; } catch { return false; } },
    release: async (eventId) => { await firestore.collection('paddle_events').doc(eventId.slice(0, 128)).delete(); },
  },
  now: () => Date.now(),
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
const app = createApp({ config, store, commerce, payments: commerce, settlePaddle, revokePaddle, paddleWebhookSecret, paddleClient,
  paddleKeyStatus: firestore && paddleKeyProject ? async () => {
    const [current, lastRun] = await Promise.all(['current', 'last_run'].map((id) => firestore.collection('paddle_key_rotation').doc(id).get()));
    return { current: (current.data() as never) ?? null, lastRun: (lastRun.data() as never) ?? null };
  } : undefined, proCheckout, pricing: commerce, demoStudio, cloud: optional.cloud, safeCopy: optional.safeCopy, collab: optional.collab, presence: optional.presence, gallery: optional.gallery, cloudPhotos: optional.cloudPhotos, learning: optional.learning, learningWithdrawal: optional.learningWithdrawal, spend: optional.spend, notices: optional.notices, push: optional.push, contacts: optional.contacts, news: optional.news, mailer: optional.mailer, cloudBalance: optional.cloudBalance, safety: optional.safety, vertexLearning: optional.vertexLearning, requireAdminSwitch: true });

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
