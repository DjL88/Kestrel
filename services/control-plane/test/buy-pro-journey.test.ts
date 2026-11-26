/**
 * Buying Pro, end to end, against a fake Paddle sandbox (board x-uat-buy). Everything is wired the way server.ts wires
 * it: the real Paddle client (commerce/paddle.ts) over a fake fetch, the real checkout, settlement and refund modules,
 * the real routes, and the app's own licence client (src/providers/licenceSync.ts) as a web browser and as desktops.
 *
 * Pro is sold only as a subscription (26 Nov 2026). One buyer walks the whole path: a monthly checkout with the offer
 * off and on (#1687), Paddle's signed notification, Pro on in web and desktop until the paid-through date (no permanent
 * key: a subscription is not owned), the 5-device limit (#1680), then a full refund turns Pro off everywhere.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { decideAccountAccess, type KestrelPlatform } from '../../../src/core/licenceOnline.ts';
import { LicenceSync, type KeyValueStorage } from '../../../src/providers/licenceSync.ts';
import { paddleApi } from '../src/commerce/paddle.ts';
import { paddleProCheckout, type StoredProOrder } from '../src/commerce/proCheckout.ts';
import { paddleProLicenceId, paddleRefundRevocation } from '../src/commerce/paddleRefunds.ts';
import { paddleProSettlement, SUBSCRIPTION_GRACE_DAYS, type ProSubscriptionRecord } from '../src/commerce/proSettlement.ts';
import { CommerceLedger, countsAsUkTurnover } from '../src/commerce/ledger.ts';
import { commerceCollections, type TransactionRecord } from '../src/commerce/records.ts';
import type { Mailer } from '../src/mailer.ts';
import type { NoticeContacts } from '../src/noticeContacts.ts';
import { startHarness, type Harness } from './helpers.ts';
import { MemoryFirestore } from './memoryFirestore.ts';

const PRICE = 'pri_01testmonthlypro';
const PROMO = 'dsc_01testblackfriday';
const SECRET = 'pdl_ntfset_test_only_secret';
const CHECKOUT_PAGE = 'https://inflight.studio/pro-checkout';
const DAY = 86_400_000;

/** Paddle's sandbox API as the control plane sees it: transactions it opened, and refunds approved in the dashboard. */
function fakePaddleSandbox() {
  const txns = new Map<string, { custom_data: Record<string, string>; price: string; discount?: string; status: string; subscription_id?: string }>();
  const adjustments = new Map<string, Record<string, unknown>>();
  const view = (id: string) => {
    const t = txns.get(id)!;
    const done = t.status === 'completed';
    // £2.99 a month full price; the offer takes 30% off. Paddle adds the buyer's tax and pays out what is left after its fee.
    const subtotal = t.discount ? 209 : 299;
    const tax = Math.round(subtotal * 0.2);
    return {
      id, status: t.status, currency_code: 'GBP', custom_data: t.custom_data, subscription_id: t.subscription_id ?? null,
      billed_at: done ? '2026-11-28T12:00:00Z' : null, updated_at: '2026-11-28T12:00:00Z',
      items: [{ price: { id: t.price }, quantity: 1 }],
      details: {
        totals: { subtotal: String(subtotal), tax: String(tax), total: String(subtotal + tax), currency_code: 'GBP' },
        payout_totals: done ? { subtotal: String(subtotal), tax: '0', total: String(subtotal), fee: '50', earnings: String(subtotal - 50), currency_code: 'GBP' } : null,
      },
      checkout: { url: CHECKOUT_PAGE + '?_ptxn=' + id },
      address: { country_code: 'GB' },
    };
  };
  const request = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    assert.equal(u.origin, 'https://sandbox-api.paddle.com', 'the sandbox, never live Paddle');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer pdl_sdbx_test_only_key');
    if (u.pathname === '/transactions' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      const id = 'txn_01sandbox' + String(txns.size).padStart(6, '0');
      txns.set(id, { custom_data: body.custom_data, price: body.items[0].price_id, discount: body.discount_id, status: 'ready' });
      return Response.json({ data: view(id) }, { status: 201 });
    }
    if (u.pathname.startsWith('/subscriptions/')) {
      const sid = decodeURIComponent(u.pathname.split('/').pop()!);
      const t = [...txns.values()].find((x) => x.subscription_id === sid);
      return t ? Response.json({ data: { id: sid, status: 'active', custom_data: t.custom_data, customer_id: 'ctm_01sandboxbuyer01',
        current_billing_period: { starts_at: '2026-11-28T12:00:00Z', ends_at: '2026-12-28T12:00:00Z' } } }) : new Response(null, { status: 404 });
    }
    if (u.pathname === '/adjustments') return Response.json({ data: [...adjustments.values()].filter((a) => a.id === u.searchParams.get('id')) });
    const id = decodeURIComponent(u.pathname.split('/').pop()!);
    return txns.has(id) ? Response.json({ data: view(id) }) : new Response(null, { status: 404 });
  }) as typeof fetch;
  /** What the buyer does on Paddle's form: pay with the test card 4242 4242 4242 4242. */
  const pay = (id: string) => { const t = txns.get(id)!; t.status = 'completed'; t.subscription_id = 'sub_01sandbox' + id.slice(-6); };
  /** What the owner does in the sandbox dashboard: approve a full refund of the transaction. */
  const refund = (id: string, txn: string) => adjustments.set(id, { id, action: 'refund', type: 'full', status: 'approved', transaction_id: txn, totals: { total: view(txn).details.totals.total, currency_code: 'GBP' } });
  return { request, txns, pay, refund };
}

async function rig() {
  const paddle = fakePaddleSandbox();
  const mails: { to: string; accountId: string; subject: string; text: string }[] = [];
  const addresses = new Map<string, string>();
  let checkout: ReturnType<typeof paddleProCheckout> | undefined;
  let settle: ReturnType<typeof paddleProSettlement> | undefined;
  let revoke: ReturnType<typeof paddleRefundRevocation> | undefined;
  const h = await startHarness(null, undefined, {
    settlePaddle: (id, hint) => settle!(id, hint),
    revokePaddle: (eventId, adjustmentId) => revoke!(eventId, adjustmentId),
    paddleWebhookSecret: SECRET,
    paddleClient: { environment: 'sandbox', clientToken: 'test_sandbox_clienttoken' },
    proCheckout: { start: (input) => checkout!.start(input), status: (input) => checkout!.status(input) },
    mailer: { sendNotice: async (m: (typeof mails)[number]) => { mails.push(m); return { sent: true }; } } as unknown as Mailer,
    contacts: { addressBook: async (accountId: string) => (addresses.has(accountId) ? { address: addresses.get(accountId)! } : undefined) } as unknown as NoticeContacts,
  });
  const orders = new Map<string, StoredProOrder>();
  // The real commerce ledger (what /admin Accounts and the VAT turnover read), on the in-memory Firestore.
  const db = new MemoryFirestore();
  const commerce = new CommerceLedger(db as never);
  const sales = () => db.runQuery({ collection: commerceCollections.transactions, filters: [] }).docs.map((d) => d.data() as TransactionRecord);
  const claimed = new Set<string>();
  const api = paddleApi({ apiKey: 'pdl_sdbx_test_only_key', environment: 'sandbox' }, paddle.request);
  const findOrder = async (id: string) => orders.get(id) ?? null;
  // As server.ts: the buyer's key is emailed once, when the payment first creates the licence.
  const subscriptions = new Map<string, ProSubscriptionRecord>();
  settle = paddleProSettlement({
    findOrder, paddle: api, licences: h.app.store,
    commerce, now: () => h.clock.now,
    subscriptions: { save: async (r) => { subscriptions.set(r.subscriptionId, r); }, get: async (id) => subscriptions.get(id) ?? null },
    onNewLicence: async (licence) => { await h.app.sendLicenceKey(licence); },
  });
  revoke = paddleRefundRevocation({
    findOrder, paddle: api, licences: h.app.store, commerce, now: () => h.clock.now,
    events: { claim: async (id) => (claimed.has(id) ? false : (claimed.add(id), true)), release: async (id) => { claimed.delete(id); } },
  });
  checkout = paddleProCheckout({
    paddle: api, priceIds: { monthly: PRICE }, checkoutUrl: CHECKOUT_PAGE, settle, promoDiscountId: PROMO, now: () => h.clock.now,
    orders: { save: async (o) => { assert.ok(!orders.has(o.transactionId)); orders.set(o.transactionId, o); }, get: findOrder },
  });
  const notify = (body: unknown) => {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(h.clock.now / 1000));
    const h1 = crypto.createHmac('sha256', SECRET).update(ts + ':' + raw).digest('hex');
    return h.call('POST', '/v1/billing/paddle', { raw, headers: { 'content-type': 'application/json', 'paddle-signature': `ts=${ts};h1=${h1}` } });
  };
  return { h, paddle, orders, sales, mails, addresses, notify };
}

const memory = (): KeyValueStorage => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
};

/**
 * The app on one device. The Firebase sign-in exchange is stood in for (it hands back the buyer's session); every
 * other request goes to the real control plane.
 */
function device(h: Harness, platform: KestrelPlatform, session: string) {
  const exchange = (async (url: string | URL, init?: RequestInit) => String(url).endsWith('/v1/auth/firebase')
    ? Response.json({ accessToken: session }) : fetch(url, init)) as typeof fetch;
  return new LicenceSync({
    baseUrl: h.url, grantKeys: { [h.app.config.signingKey.keyId]: h.app.config.signingKey.publicKeyBase64 },
    storage: memory(), fetch: exchange, now: () => h.clock.now, platform, appVersion: '26.11.2',
  });
}

async function buyer(h: Harness, email: string) {
  const accountId = await h.app.createAccount(email, 'test-password-with-length', 'user');
  return { accountId, session: (await h.app.issueSession(accountId, 'user')).accessToken };
}

const event = (type: string, id: string) => ({ event_id: 'evt_' + type + '_' + id, event_type: type, occurred_at: '2026-11-28T12:00:00Z', data: { id } });

test('subscribe to Pro with the offer on: signed notification, Pro on web and desktop until the paid-through date, 5 devices, refund turns it off', async () => {
  const { h, paddle, orders, sales, mails, addresses, notify } = await rig();
  try {
    // The offer (#1687) runs on Black Friday only.
    const startsAtMs = Date.UTC(2026, 10, 27);
    const set = await h.call('POST', '/v1/admin/flags/set', { token: h.adminToken, body: { key: 'proPromo', flag: { default: false, rules: [{ audience: { kind: 'any' }, enabled: true, startsAtMs, endsAtMs: startsAtMs + 4 * DAY }] } } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    h.clock.now = startsAtMs + DAY;

    const me = await buyer(h, 'journey@example.test');
    addresses.set(me.accountId, 'journey@example.test');
    const web = device(h, 'web', me.session);
    const windows = device(h, 'windows', me.session);
    const mac = device(h, 'macos', me.session);

    // Before paying, signing in is Free on every platform.
    assert.deepEqual(await web.activateAccount('id-token'), { kind: 'no_licence' });

    // The page that opens Paddle.js gets the sandbox settings.
    const config = await h.call('GET', '/v1/billing/paddle/config');
    assert.deepEqual(config.body, { environment: 'sandbox', clientToken: 'test_sandbox_clienttoken' });

    // Buy Pro from the web app: our checkout page for one server-priced, account-bound Paddle transaction, with the offer.
    const start = await web.startProCheckout('id-token');
    assert.ok(start.ok, JSON.stringify(start));
    if (!start.ok) return;
    assert.equal(start.url, CHECKOUT_PAGE + '?_ptxn=' + start.checkoutId);
    const txn = paddle.txns.get(start.checkoutId)!;
    assert.equal(txn.price, PRICE);
    assert.equal(txn.discount, PROMO);
    assert.equal(orders.get(start.checkoutId)!.discountId, PROMO);
    assert.equal(await web.proCheckoutStatus('id-token', start.checkoutId), 'pending');

    // The buyer pays; Paddle's signed transaction.completed arrives (twice, as Paddle may retry).
    paddle.pay(start.checkoutId);
    assert.equal((await notify(event('transaction.completed', start.checkoutId))).status, 200);
    assert.equal((await notify(event('transaction.completed', start.checkoutId))).status, 200);
    assert.equal(await web.proCheckoutStatus('id-token', start.checkoutId), 'paid');
    assert.equal(sales().length, 1, 'one sale, however many notifications');
    const sale = sales()[0]!;
    assert.equal(sale.status, 'paid');
    assert.ok(countsAsUkTurnover(sale));
    assert.deepEqual(sale.buyer, { country: 'GB', currency: 'GBP', totalMinor: 251, taxMinor: 42 }, 'the discounted price was charged');
    assert.equal(sale.netPence, 159);

    // A subscription is not owned: no permanent key is emailed, and Pro lasts to the paid-through date plus grace.
    assert.equal(mails.length, 0);
    const licenceId = paddleProLicenceId(orders.get(start.checkoutId)!);
    const paidThrough = Date.UTC(2026, 11, 28, 12);
    assert.equal((await h.app.store.getLicence(licenceId))!.validUntilMs, paidThrough + SUBSCRIPTION_GRACE_DAYS * DAY);

    // Pro turns on in the web app and on both desktops by signing in, with no owned flag and no key.
    for (const app of [web, windows, mac]) {
      const standing = await app.activateAccount('id-token');
      assert.equal(standing?.kind, 'active', JSON.stringify(standing));
      if (standing?.kind !== 'active') return;
      assert.equal(standing.grant.flags?.['licence.owned'], undefined);
      assert.equal(standing.licenceKey, undefined);
      assert.equal(decideAccountAccess(standing, h.clock.now).pro, true);
      // Offline, Pro lasts its window (30 days at most since the last check), never for good.
      assert.equal(decideAccountAccess(standing, h.clock.now + 400 * DAY).pro, false);
    }

    // The 5-device limit (#1680): a fourth and fifth device fit, a sixth is refused.
    assert.equal((await device(h, 'ios', me.session).activateAccount('id-token'))?.kind, 'active');
    assert.equal((await device(h, 'android', me.session).activateAccount('id-token'))?.kind, 'active');
    const sixth = await device(h, 'ios', me.session).activateAccount('id-token');
    assert.equal(sixth?.kind, 'device_limit');

    // Buying again is refused: they already have Pro.
    const again = await mac.startProCheckout('id-token');
    assert.equal(!again.ok && again.code, 'ALREADY_PRO');

    // The owner approves a full refund in the sandbox; Paddle's signed adjustment notification removes Pro.
    paddle.refund('adj_01sandboxrefund0001', start.checkoutId);
    const refunded = await notify(event('adjustment.updated', 'adj_01sandboxrefund0001'));
    assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
    assert.equal(refunded.body.outcome, 'revoked');
    assert.equal((await h.app.store.getLicence(licenceId))!.status, 'revoked');
    assert.equal((await notify(event('adjustment.updated', 'adj_01sandboxrefund0001'))).body.outcome, 'duplicate');
    // The sale is marked refunded, so /admin Accounts and the UK VAT turnover stop counting it as income.
    assert.equal(sales()[0]!.status, 'refunded');
    assert.equal(countsAsUkTurnover(sales()[0]!), false);

    // Every device hears it at its next check, on web and desktop.
    for (const app of [web, windows, mac]) {
      const standing = await app.activateAccount('id-token');
      assert.equal(standing?.kind, 'no_licence', 'refunded: the account is back to Free');
      assert.equal(await app.storedAccountStanding(), null, 'the owned grant is gone from the device');
    }
    // A late or repeated completion cannot bring it back.
    assert.equal((await notify({ ...event('transaction.completed', start.checkoutId), event_id: 'evt_late' })).status, 200);
    assert.equal((await h.app.store.getLicence(licenceId))!.status, 'revoked');
    assert.equal(mails.length, 0, 'never a key email for a subscription');
  } finally { await h.close(); }
});

test('with the offer off, the checkout is full price and a refund still removes Pro', async () => {
  const { h, paddle, orders, sales, notify } = await rig();
  try {
    const me = await buyer(h, 'fullprice@example.test');
    const app = device(h, 'macos', me.session);
    const start = await app.startProCheckout('id-token');
    assert.ok(start.ok);
    if (!start.ok) return;
    assert.equal(paddle.txns.get(start.checkoutId)!.discount, undefined);
    assert.equal(orders.get(start.checkoutId)!.discountId, undefined);
    paddle.pay(start.checkoutId);
    // The notification is late: the app's own check settles the payment.
    assert.equal(await app.proCheckoutStatus('id-token', start.checkoutId), 'paid');
    assert.equal(sales()[0]!.buyer?.totalMinor, 359);
    assert.equal((await app.activateAccount('id-token'))?.kind, 'active');
    paddle.refund('adj_01sandboxrefund0002', start.checkoutId);
    assert.equal((await notify(event('adjustment.created', 'adj_01sandboxrefund0002'))).body.outcome, 'revoked');
    assert.equal((await app.activateAccount('id-token'))?.kind, 'no_licence');
    assert.equal(sales()[0]!.status, 'refunded');
  } finally { await h.close(); }
});
