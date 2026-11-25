import { createServer } from 'node:http';
import { createApp, openApi } from './app.ts';
import { CloudDemoStudio } from './demoStudio.ts';
import { loadConfig } from './config.ts';
import { CommerceLedger } from './commerce/ledger.ts';
import { sumupProSettlement, type ProPurchaseOrder } from './commerce/proSettlement.ts';
import { sumupCheckouts } from './commerce/sumup.ts';
import { sumupProCheckout, type StoredProOrder } from './commerce/proCheckout.ts';
import { FirestoreStore, type FirestoreLike } from './firestoreStore.ts';
import { openFirestore, openStore } from './openStore.ts';
import { buildOptionalServices } from './wiring.ts';
import { dbipCountryLookup, networkCountryFrom } from './networkCountry.ts';

const config = loadConfig();
const firestore = config.store === 'firestore' ? await openFirestore(config) : undefined;
const store = firestore ? new FirestoreStore(firestore as unknown as FirestoreLike) : await openStore(config);
const commerce = firestore ? new CommerceLedger(firestore) : undefined;
const sumupKey = process.env.KCP_SUMUP_API_KEY?.trim();
const sumupMerchant = process.env.KCP_SUMUP_MERCHANT_CODE?.trim();
const sumup = sumupKey && sumupMerchant ? sumupCheckouts({ apiKey: sumupKey, merchantCode: sumupMerchant }) : undefined;
const settleSumupPro = firestore && commerce && sumup ? sumupProSettlement({
  findOrder: async (checkoutId) => (await firestore.collection('sumup_pro_orders').doc(checkoutId).get()).data() as ProPurchaseOrder | undefined ?? null,
  checkouts: sumup,
  commerce,
  licences: store,
}) : undefined;
// SumUp returns the buyer to the published website (the first HTTPS app origin, i.e. the Hosting site Terraform adds).
const siteUrl = process.env.KCP_PUBLIC_SITE_URL?.trim() || config.allowedOrigins.find((o) => o.startsWith('https://') && o !== 'https://tauri.localhost');
const proCheckout = firestore && commerce && sumup && settleSumupPro && siteUrl ? sumupProCheckout({
  checkouts: sumup,
  orders: {
    // create() refuses to overwrite: a checkout ID is bound to one account for good.
    save: async (order) => { await firestore.collection('sumup_pro_orders').doc(order.checkoutId).create(order); },
    get: async (checkoutId) => (await firestore.collection('sumup_pro_orders').doc(checkoutId).get()).data() as StoredProOrder | undefined ?? null,
  },
  taxSettings: () => commerce.getTaxSettings(),
  settle: settleSumupPro,
  hasPaidLicence: async (accountId, licenceId) => (await store.listLicencesForAccount(accountId)).some((l) => l.licenceId === licenceId && l.paid),
  redirectUrl: new URL('/pro-complete', siteUrl).toString(),
  callbackUrl: process.env.KCP_PUBLIC_API_URL?.trim() ? new URL('/v1/billing/sumup', process.env.KCP_PUBLIC_API_URL.trim()).toString() : undefined,
}) : undefined;
const networkCountry = proCheckout ? networkCountryFrom(await dbipCountryLookup()) : undefined;
const demoStudio = firestore && process.env.KCP_DEMO_PRIVATE_BUCKET && process.env.KCP_DEMO_PUBLIC_BUCKET
  ? new CloudDemoStudio(firestore, process.env.KCP_DEMO_PRIVATE_BUCKET, process.env.KCP_DEMO_PUBLIC_BUCKET) : undefined;
const optional = await buildOptionalServices({ firestore: firestore as unknown as FirestoreLike | undefined });
const app = createApp({ config, store, commerce, payments: commerce, settleSumupPro, proCheckout, networkCountry, pricing: commerce, demoStudio, cloud: optional.cloud, safeCopy: optional.safeCopy, collab: optional.collab, presence: optional.presence, gallery: optional.gallery, notices: optional.notices, cloudPhotos: optional.cloudPhotos, learning: optional.learning, learningWithdrawal: optional.learningWithdrawal, spend: optional.spend, vertexLearning: optional.vertexLearning, requireAdminSwitch: true });

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
