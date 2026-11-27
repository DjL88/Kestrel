import { createServer } from 'node:http';
import { createApp, openApi } from './app.ts';
import { loadConfig } from './config.ts';
import { CommerceLedger } from './commerce/ledger.ts';
import { fetchEcbRatesPerGbp } from './commerce/priceReview.ts';
import { paddleProBilling, type ProPurchaseOrder, type ProSubscriptionRecord } from './commerce/proSettlement.ts';
import { paddleRefundRevocation } from './commerce/paddleRefunds.ts';
import { accountMerges } from './accountMerge.ts';
import { buildAccountErasure } from './accountErasureWiring.ts';
import { paddleApi } from './commerce/paddle.ts';
import { rotatingKeySource, secretManagerSecret } from './commerce/paddleKeyRotation.ts';
import { paddleProCheckout, type StoredProOrder } from './commerce/proCheckout.ts';
import { paddleTopUps, TOP_UP_AMOUNTS_PENCE, type TopUpOrder, type TopUpPence } from './commerce/topUpCheckout.ts';
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
// Pro is sold only as a subscription (26 Nov 2026). The one-off price (KCP_PADDLE_PRO_PRICE_ID) is no longer offered;
// its orders are stored with their own price, so licences already sold still settle and stay honoured.
const paddlePrice = (name: string) => { const v = process.env[name]?.trim(); return v && /^pri_[a-z0-9]{10,60}$/.test(v) ? v : undefined; };
const paddlePriceIds = { monthly: paddlePrice('KCP_PADDLE_MONTHLY_PRICE_ID'), annual: paddlePrice('KCP_PADDLE_ANNUAL_PRICE_ID') };
const paddleWebhookSecret = process.env.KCP_PADDLE_WEBHOOK_SECRET?.trim() || undefined;
const paddleClientToken = process.env.KCP_PADDLE_CLIENT_TOKEN?.trim();
// Optional offer (for example Black Friday): a Paddle discount ID. It applies only while the admin flag proPromo is on.
const paddlePromoDiscountId = /^dsc_[a-z0-9]{10,60}$/.test(process.env.KCP_PADDLE_PROMO_DISCOUNT_ID?.trim() ?? '') ? process.env.KCP_PADDLE_PROMO_DISCOUNT_ID!.trim() : undefined;
// The key is renewed by the kestrel-paddle-key-rotation job (infra/gcp/paddle-key-rotation.tf). When
// KCP_PADDLE_KEY_PROJECT is set the server re-reads the latest secret version every 5 minutes, so a new key takes over
// without a redeploy; the value Cloud Run injected at start-up is the fallback.
const paddleKeyProject = process.env.KCP_PADDLE_KEY_PROJECT?.trim();
const paddleApiKey = paddleKey && paddleKeyProject
  ? rotatingKeySource(secretManagerSecret({ project: paddleKeyProject, secret: process.env.KCP_PADDLE_KEY_SECRET?.trim() || 'kestrel-paddle-api-key' }).latest, paddleKey)
  : paddleKey;
const paddle = paddleApiKey ? paddleApi({ apiKey: paddleApiKey, environment: paddleEnvironment }) : undefined;
const paddleOrders = 'paddle_pro_orders';
const paddleSubscriptions = 'paddle_pro_subscriptions';
const paddleBilling = firestore && commerce && paddle ? paddleProBilling({
  findOrder: async (id) => (await firestore.collection(paddleOrders).doc(id).get()).data() as ProPurchaseOrder | undefined ?? null,
  paddle,
  commerce,
  licences: store,
  subscriptions: {
    save: async (record) => { await firestore.collection(paddleSubscriptions).doc(record.subscriptionId).set(record); },
    get: async (id) => (await firestore.collection(paddleSubscriptions).doc(id).get()).data() as ProSubscriptionRecord | undefined ?? null,
    forAccount: async (accountId) => (await firestore.collection(paddleSubscriptions).where('accountId', '==', accountId).limit(20).get()).docs.map((doc) => doc.data() as ProSubscriptionRecord),
  },
  // The buyer's key by email, once per purchase. `app` is created below; this runs only when a payment arrives.
  onNewLicence: async (licence) => { await app.sendLicenceKey(licence); },
}) : undefined;
const proSettle = paddleBilling?.settle;
const syncPaddleSubscription = paddleBilling?.syncSubscription;
const managePaddleSubscription = paddleBilling?.manage;
// A full refund or chargeback of a Pro order removes Pro. Each Paddle event id is claimed once (create() refuses a second).
const revokePaddle = firestore && paddle ? paddleRefundRevocation({
  findOrder: async (id) => (await firestore.collection(paddleOrders).doc(id).get()).data() as ProPurchaseOrder | undefined ?? null,
  paddle,
  licences: store,
  commerce,
  events: {
    claim: async (eventId, atMs) => { try { await firestore.collection('paddle_events').doc(eventId.slice(0, 128)).create({ atMs }); return true; } catch { return false; } },
    release: async (eventId) => { await firestore.collection('paddle_events').doc(eventId.slice(0, 128)).delete(); },
  },
  now: () => Date.now(),
}) : undefined;
// The checkout page is on the published website (the first HTTPS app origin, i.e. the Hosting site Terraform adds).
const siteUrl = process.env.KCP_PUBLIC_SITE_URL?.trim() || config.allowedOrigins.find((o) => o.startsWith('https://') && o !== 'https://tauri.localhost');
const proCheckout = firestore && paddle && proSettle && (paddlePriceIds.monthly || paddlePriceIds.annual) && siteUrl ? paddleProCheckout({
  paddle,
  orders: {
    // create() refuses to overwrite: a transaction ID is bound to one account for good.
    save: async (order) => { await firestore.collection(paddleOrders).doc(order.transactionId).create(order); },
    get: async (id) => (await firestore.collection(paddleOrders).doc(id).get()).data() as StoredProOrder | undefined ?? null,
  },
  priceIds: paddlePriceIds,
  checkoutUrl: new URL('/pro-checkout', siteUrl).toString(),
  settle: proSettle,
  promoDiscountId: paddlePromoDiscountId,
}) : undefined;
const paddleClient = paddleClientToken ? { environment: paddleEnvironment, clientToken: paddleClientToken } as const : undefined;
const optional = await buildOptionalServices({ firestore: firestore as unknown as FirestoreLike | undefined, sessionSecret: config.sessionSecret });
// Cloud top-ups: KCP_PADDLE_TOPUP_PRICE_IDS is JSON, {"500":"pri_…","1000":"pri_…","2000":"pri_…"} (Terraform).
const topUpPriceIds = (() => {
  try {
    const raw = JSON.parse(process.env.KCP_PADDLE_TOPUP_PRICE_IDS?.trim() || '{}') as Record<string, unknown>;
    const out: Partial<Record<TopUpPence, string>> = {};
    for (const p of TOP_UP_AMOUNTS_PENCE) { const v = raw[String(p)]; if (typeof v === 'string' && /^pri_[a-z0-9]{10,60}$/.test(v)) out[p] = v; }
    return out;
  } catch { return {}; }
})();
const topUpOrders = 'paddle_topup_orders';
const topUpCheckout = firestore && paddle && commerce && optional.cloudBalance && siteUrl && Object.keys(topUpPriceIds).length ? paddleTopUps({
  paddle,
  orders: {
    save: async (order) => { await firestore.collection(topUpOrders).doc(order.transactionId).create(order); },
    get: async (id) => (await firestore.collection(topUpOrders).doc(id).get()).data() as TopUpOrder | undefined ?? null,
  },
  priceIds: topUpPriceIds,
  checkoutUrl: new URL('/pro-checkout', siteUrl).toString(),
  commerce,
  balance: optional.cloudBalance,
}) : undefined;
// One Paddle notification route: a top-up order settles here; anything else goes to Pro (first payments, renewals, older one-off orders).
const settlePaddle = proSettle ? async (id: string, hint?: { subscriptionId?: string }) => {
  const asTopUp = topUpCheckout ? await topUpCheckout.settle(id) : 'unknown';
  return asTopUp !== 'unknown' ? asTopUp : proSettle(id, hint);
} : undefined;
// Merging two accounts (accountMerge.ts): needs Firestore for its records; moves what the optional services hold.
const accountMerge = firestore ? accountMerges({ db: firestore as unknown as FirestoreLike, store, secret: config.sessionSecret, balance: optional.cloudBalance, collab: optional.collab, push: optional.push, safeCopy: optional.safeCopy?.catalog, now: () => Date.now() }) : undefined;
// Download my data and Delete my account (accountErasure.ts): needs Firestore; the daily job builds it the same way.
const erasure = firestore ? await buildAccountErasure(firestore as unknown as FirestoreLike, store as FirestoreStore) : undefined;
const app = createApp({ config, store, commerce, payments: commerce, paddleEnvironment: paddle ? paddleEnvironment : undefined, settlePaddle, syncPaddleSubscription, managePaddleSubscription, revokePaddle, accountMerge, accountErasure: erasure, paddleWebhookSecret, paddleClient,
  paddleKeyStatus: firestore && paddleKeyProject ? async () => {
    const [current, lastRun] = await Promise.all(['current', 'last_run'].map((id) => firestore.collection('paddle_key_rotation').doc(id).get()));
    return { current: (current.data() as never) ?? null, lastRun: (lastRun.data() as never) ?? null };
  } : undefined,
  proSubscriberCounts: firestore ? async () => {
    const current = await firestore.collection(paddleSubscriptions).where('status', 'in', ['active', 'trialing']).limit(10_000).get();
    const counts = { monthly: 0, annual: 0 };
    for (const doc of current.docs) counts[(doc.data() as ProSubscriptionRecord).plan === 'annual' ? 'annual' : 'monthly'] += 1;
    return counts;
  } : undefined, proCheckout, topUpCheckout, pricing: commerce,
  priceMatrix: commerce ? { get: () => commerce.getPriceMatrix(), save: (matrix) => commerce.savePriceMatrix(matrix) } : undefined,
  paddlePrices: paddle ? { priceIds: paddlePriceIds, get: (id) => paddle.getPrice(id), update: (id, body) => paddle.updatePrice(id, body) } : undefined,
  ecbRates: () => fetchEcbRatesPerGbp(), cloud: optional.cloud, safeCopy: optional.safeCopy, collab: optional.collab, presence: optional.presence, gallery: optional.gallery, cloudPhotos: optional.cloudPhotos, learning: optional.learning, learningWithdrawal: optional.learningWithdrawal, spend: optional.spend, notices: optional.notices, push: optional.push, contacts: optional.contacts, news: optional.news, mailer: optional.mailer, contactNotify: optional.contactNotify, cloudBalance: optional.cloudBalance, safety: optional.safety, compliance: optional.compliance, vertexLearning: optional.vertexLearning, requireAdminSwitch: true });

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
