import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { paddleApi, verifyPaddleSignature } from '../src/commerce/paddle.ts';
import { paddleProCheckout, type StoredProOrder } from '../src/commerce/proCheckout.ts';
import { paddleProBilling, SUBSCRIPTION_GRACE_DAYS, type ProSubscriptionRecord } from '../src/commerce/proSettlement.ts';
import type { TransactionRecord } from '../src/commerce/records.ts';
import { startHarness, type Harness } from './helpers.ts';

const PRICE = 'pri_01testmonthlypro';
const ANNUAL = 'pri_01testannualpro';
/** The retired one-off price: no longer sold, but orders already paid are honoured. */
const LIFETIME = 'pri_01testlifetimepro';
const DAY = 86_400_000;
const SECRET = 'pdl_ntfset_test_only_secret';

/**
 * A fake Paddle sandbox: records created transactions; tests decide when one is completed. A completed transaction for
 * a recurring price gets a subscription, as Paddle does, with the transaction's custom_data copied onto it.
 */
function fakePaddle() {
  const txns = new Map<string, { custom_data: Record<string, string>; price: string; status: string; subscription_id?: string | null; discount_id?: string }>();
  // The offer discount as Paddle has it (made in the dashboard). Tests change it as Paddle would.
  const discount: { status: string; expires_at: string | null; usage_limit: number | null; times_used: number; fail?: boolean } = { status: 'active', expires_at: '2026-12-01T00:00:00Z', usage_limit: null, times_used: 0 };
  const subs = new Map<string, { status: string; custom_data: Record<string, string>; ends_at: string | null; scheduled?: { action: string; effective_at: string } | null }>();
  const state = { creates: 0, gets: 0, failGets: false };
  const view = (id: string) => {
    const t = txns.get(id)!;
    const done = t.status === 'completed';
    if (done && t.subscription_id === undefined && (t.price === PRICE || t.price === ANNUAL)) {
      t.subscription_id = 'sub_01test' + String(subs.size).padStart(6, '0');
      const months = t.price === ANNUAL ? 12 : 1;
      subs.set(t.subscription_id, { status: 'active', custom_data: t.custom_data, ends_at: new Date(Date.UTC(2026, 10 + months, 18, 12)).toISOString() });
    }
    return {
      id, status: t.status, currency_code: 'EUR', custom_data: t.custom_data, subscription_id: t.subscription_id ?? null,
      billed_at: done ? '2026-11-18T12:00:00Z' : null, updated_at: '2026-11-18T12:00:00Z',
      items: [{ price: { id: t.price }, quantity: 1 }],
      details: {
        totals: { subtotal: '2900', tax: '580', total: '3480', currency_code: 'EUR' },
        payout_totals: done ? { subtotal: '2500', tax: '500', total: '3000', fee: '170', earnings: '2330', currency_code: 'GBP' } : null,
      },
      checkout: { url: 'https://site.example.test/pro-checkout?_ptxn=' + id },
      address: { country_code: 'FR' },
    };
  };
  const request = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    assert.equal(u.origin, 'https://sandbox-api.paddle.com');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-only-key');
    if (u.pathname === '/transactions' && init?.method === 'POST') {
      state.creates++;
      const body = JSON.parse(String(init.body));
      assert.equal(body.checkout.url, 'https://site.example.test/pro-checkout');
      const id = 'txn_01test' + String(txns.size).padStart(6, '0');
      txns.set(id, { custom_data: body.custom_data, price: body.items[0].price_id, status: 'ready', discount_id: body.discount_id });
      return Response.json({ data: view(id) }, { status: 201 });
    }
    if (u.pathname.startsWith('/discounts/')) {
      if (discount.fail) return new Response(null, { status: 500 });
      return Response.json({ data: { id: decodeURIComponent(u.pathname.split('/').pop()!), status: discount.status, expires_at: discount.expires_at, usage_limit: discount.usage_limit, times_used: discount.times_used } });
    }
    state.gets++;
    if (state.failGets) return new Response(null, { status: 500 });
    const portal = u.pathname === '/customers/ctm_01testcustomer01/portal-sessions';
    if (portal && init?.method === 'POST') {
      const sid = JSON.parse(String(init.body)).subscription_ids[0];
      return Response.json({ data: { urls: { general: { overview: 'https://sandbox-customer-portal.paddle.com/cpl_test/overview' }, subscriptions: [{ id: sid, cancel_subscription: 'https://sandbox-customer-portal.paddle.com/cpl_test/cancel', update_subscription_payment_method: 'https://sandbox-customer-portal.paddle.com/cpl_test/card' }] } } }, { status: 201 });
    }
    if (u.pathname.startsWith('/subscriptions/')) {
      const sid = decodeURIComponent(u.pathname.split('/').pop()!);
      const s = subs.get(sid);
      if (!s) return new Response(null, { status: 404 });
      return Response.json({ data: { id: sid, status: s.status, custom_data: s.custom_data, current_billing_period: s.ends_at ? { starts_at: '2026-11-18T12:00:00Z', ends_at: s.ends_at } : null, scheduled_change: s.scheduled ?? null, customer_id: 'ctm_01testcustomer01' } });
    }
    assert.equal(u.searchParams.get('include'), 'address');
    const id = decodeURIComponent(u.pathname.split('/').pop()!);
    return txns.has(id) ? Response.json({ data: view(id) }) : new Response(null, { status: 404 });
  }) as typeof fetch;
  return { request, state, txns, subs, discount };
}

function signed(body: unknown, nowMs: number, secret = SECRET) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(nowMs / 1000));
  const h1 = crypto.createHmac('sha256', secret).update(ts + ':' + raw).digest('hex');
  return { raw, headers: { 'content-type': 'application/json', 'paddle-signature': `ts=${ts};h1=${h1}` } };
}

async function setup(requireAdminSwitch = false, promoDiscountId?: string) {
  const paddle = fakePaddle();
  let bound: ReturnType<typeof paddleProCheckout> | undefined;
  let billing: ReturnType<typeof paddleProBilling> | undefined;
  const harness = await startHarness(null, undefined, {
    requireAdminSwitch,
    settlePaddle: (id, hint) => billing!.settle(id, hint),
    syncPaddleSubscription: (id) => billing!.syncSubscription(id),
    managePaddleSubscription: (id) => billing!.manage(id),
    paddleWebhookSecret: SECRET,
    paddleClient: { environment: 'sandbox', clientToken: 'test_clienttoken' },
    proCheckout: { start: (input) => bound!.start(input), status: (input) => bound!.status(input), offer: () => bound!.offer() },
  });
  const orders = new Map<string, StoredProOrder>();
  const ledger = new Map<string, TransactionRecord>();
  const api = paddleApi({ apiKey: 'test-only-key', environment: 'sandbox' }, paddle.request);
  const subscriptions = new Map<string, ProSubscriptionRecord>();
  billing = paddleProBilling({
    findOrder: async (id) => orders.get(id) ?? null,
    paddle: api,
    commerce: { recordPaid: async (r) => { if (!ledger.has(r.checkoutReference)) ledger.set(r.checkoutReference, r); return ledger.get(r.checkoutReference)!; } },
    licences: harness.app.store,
    subscriptions: { save: async (s) => { subscriptions.set(s.subscriptionId, s); }, get: async (id) => subscriptions.get(id) ?? null, forAccount: async (a) => [...subscriptions.values()].filter((s) => s.accountId === a) },
    now: () => harness.clock.now,
  });
  const settle = billing.settle;
  bound = paddleProCheckout({
    paddle: api,
    orders: { save: async (o) => { assert.ok(!orders.has(o.transactionId)); orders.set(o.transactionId, o); }, get: async (id) => orders.get(id) ?? null },
    priceIds: { monthly: PRICE, annual: ANNUAL },
    checkoutUrl: 'https://site.example.test/pro-checkout',
    settle,
    promoDiscountId,
    now: () => harness.clock.now,
  });
  const webhook = (body: unknown, secret?: string) => {
    const s = signed(body, harness.clock.now, secret);
    return harness.call('POST', '/v1/billing/paddle', { raw: s.raw, headers: s.headers });
  };
  return { harness, paddle, orders, ledger, webhook, subscriptions, api };
}

async function buyer(h: Harness, email: string) {
  const accountId = await h.app.createAccount(email, 'test-password-with-length', 'user');
  return { accountId, token: (await h.app.issueSession(accountId, 'user')).accessToken };
}

const completed = (id: string) => ({ event_id: 'evt_' + id, event_type: 'transaction.completed', occurred_at: '2026-11-18T12:00:00Z', data: { id } });

test('buyer anywhere: server-bound Paddle transaction, signed webhook, one paid Pro grant, then activation', async () => {
  const { harness: h, paddle, orders, ledger, webhook } = await setup();
  try {
    const me = await buyer(h, 'buyer@example.test');
    // No country is asked for: Paddle collects it and charges the right tax as merchant of record.
    const start = await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: {} });
    assert.equal(start.status, 201, JSON.stringify(start.body));
    const id = start.body.checkoutId;
    assert.match(id, /^txn_/);
    assert.equal(start.body.url, 'https://site.example.test/pro-checkout?_ptxn=' + id);
    const order = orders.get(id)!;
    assert.equal(order.accountId, me.accountId);
    assert.equal(order.priceId, PRICE);
    assert.match(order.reference, /^paddle_[a-f0-9]{24}$/);
    assert.equal(order.plan, 'monthly', 'no plan named: monthly, the smallest commitment');
    assert.deepEqual(paddle.txns.get(id)!.custom_data, { reference: order.reference, accountId: me.accountId, product: 'pro', plan: 'monthly', majorVersion: '1' });

    const status = () => h.call('GET', '/v1/me/checkout/pro/' + id, { token: me.token });
    const activate = () => h.call('POST', '/v1/me/activate', { token: me.token, body: { deviceHash: 'b'.repeat(64), platform: 'web', appVersion: '1.0.0' } });
    assert.deepEqual((await status()).body, { status: 'pending' });
    assert.equal((await activate()).status, 403);

    // A forged or unsigned notification changes nothing and is never even looked up.
    const gets = paddle.state.gets;
    assert.equal((await webhook(completed(id), 'wrong-secret')).status, 401);
    assert.equal((await h.call('POST', '/v1/billing/paddle', { body: completed(id) })).status, 401);
    assert.equal(paddle.state.gets, gets);

    paddle.txns.get(id)!.status = 'completed';
    assert.equal((await webhook(completed(id))).status, 200);
    assert.equal((await webhook(completed(id))).status, 200, 'a repeated notification is harmless');
    assert.deepEqual((await status()).body, { status: 'paid' });
    assert.equal(ledger.size, 1);
    const sale = [...ledger.values()][0]!;
    assert.equal(sale.treatment, 'merchant-of-record');
    assert.equal(sale.store, 'paddle');
    assert.equal(sale.currency, 'GBP');
    assert.equal(sale.netPence, 2330, 'our turnover is what Paddle pays out');
    assert.deepEqual(sale.buyer, { country: 'FR', currency: 'EUR', totalMinor: 3480, taxMinor: 580 });
    const licences = await h.app.store.listLicencesForAccount(me.accountId);
    assert.equal(licences.length, 1);
    assert.equal(licences[0]!.licenceId, 'lic_p_' + order.reference);
    assert.equal(licences[0]!.validUntilMs, Date.UTC(2026, 11, 18, 12) + SUBSCRIPTION_GRACE_DAYS * DAY, 'Pro until the paid-through date plus grace');
    const activated = await activate();
    assert.equal(activated.status, 200);
    assert.equal(activated.body.licenceKey, undefined, 'a subscription is not an owned licence: no permanent key');

    const again = await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: {} });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'ALREADY_PRO');
    assert.equal(paddle.state.creates, 1);
  } finally { await h.close(); }
});

test('the app status check alone settles a completed payment if the webhook is late', async () => {
  const { harness: h, paddle } = await setup();
  try {
    const me = await buyer(h, 'late-hook@example.test');
    const id = (await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: { country: 'GB' } })).body.checkoutId;
    paddle.txns.get(id)!.status = 'paid';
    assert.deepEqual((await h.call('GET', '/v1/me/checkout/pro/' + id, { token: me.token })).body, { status: 'pending' }, 'paid but not yet completed waits');
    paddle.txns.get(id)!.status = 'completed';
    paddle.state.failGets = true;
    assert.equal((await h.call('GET', '/v1/me/checkout/pro/' + id, { token: me.token })).status, 503);
    paddle.state.failGets = false;
    assert.deepEqual((await h.call('GET', '/v1/me/checkout/pro/' + id, { token: me.token })).body, { status: 'paid' });
  } finally { await h.close(); }
});

test('another account cannot see someone else\'s checkout; odd IDs are not found; the client cannot set an amount', async () => {
  const { harness: h, paddle } = await setup();
  try {
    const me = await buyer(h, 'owner-of-order@example.test');
    const other = await buyer(h, 'someone-else@example.test');
    const id = (await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: {} })).body.checkoutId;
    assert.equal((await h.call('GET', '/v1/me/checkout/pro/' + id, { token: other.token })).status, 404);
    assert.equal((await h.call('GET', '/v1/me/checkout/pro/..%2Fx', { token: me.token })).status, 404);
    assert.equal((await h.call('GET', '/v1/me/checkout/pro/' + id)).status, 401);
    assert.equal((await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: { totalPence: 1 } })).status, 400);
    assert.equal(paddle.state.creates, 1);
  } finally { await h.close(); }
});

test('a transaction that does not match the order (price, account, no subscription) never grants Pro', async () => {
  const { harness: h, paddle, webhook } = await setup();
  try {
    const me = await buyer(h, 'mismatch@example.test');
    const id = (await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: {} })).body.checkoutId;
    const t = paddle.txns.get(id)!;
    t.status = 'completed';
    t.price = 'pri_01somethingcheaper';
    assert.equal((await webhook(completed(id))).status, 503);
    t.price = PRICE;
    t.subscription_id = null;
    assert.equal((await webhook(completed(id))).status, 503, 'a subscription order paid without a subscription');
    t.subscription_id = undefined;
    t.custom_data = { ...t.custom_data, accountId: 'someone-else' };
    assert.equal((await webhook(completed(id))).status, 503);
    assert.equal((await h.app.store.listLicencesForAccount(me.accountId)).length, 0);
    // Unknown transactions and subscriptions are acknowledged, so Paddle does not retry them for ever.
    assert.equal((await webhook(completed('txn_01unknown000000'))).status, 200);
    assert.equal((await webhook({ event_id: 'evt_s', event_type: 'subscription.created', occurred_at: '2026-11-18T12:00:00Z', data: { id: 'sub_01unknown000000' } })).status, 200);
    assert.equal((await webhook({ ...completed('txn_01unknown000001'), data: { id: 'txn_01unknown000001', subscription_id: 'sub_01unknown000000' } })).status, 200);
  } finally { await h.close(); }
});

test('production: checkout stays off until the admin switches it on; the checkout page gets the sandbox client token', async () => {
  const { harness: h, paddle } = await setup(true);
  try {
    const me = await buyer(h, 'early@example.test');
    const off = await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: {} });
    assert.equal(off.status, 503);
    assert.equal(off.body.error.code, 'CHECKOUT_DISABLED');
    const switches = await h.call('GET', '/v1/admin/switches', { token: h.adminToken });
    const sw = switches.body.switches.find((s: { key: string }) => s.key === 'pro-checkout');
    assert.equal(sw.label, 'Pro checkout (Paddle)');
    assert.equal(sw.on, false);
    assert.equal(switches.body.switches.some((s: { key: string }) => s.key === 'pro-checkout-eu'), false, 'no EU switch: Paddle handles EU VAT');
    assert.equal((await h.call('POST', '/v1/admin/switches/set', { token: h.adminToken, body: { key: 'pro-checkout', on: true } })).status, 200);
    assert.equal((await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: {} })).status, 201);
    assert.equal(paddle.state.creates, 1);
    assert.deepEqual((await h.call('GET', '/v1/billing/paddle/config')).body, { environment: 'sandbox', clientToken: 'test_clienttoken' });
  } finally { await h.close(); }
});

test('Paddle-Signature: right secret and fresh timestamp only; any h1 during a rotation', () => {
  const now = Date.UTC(2026, 10, 18, 12);
  const body = '{"a":1}';
  const ts = String(now / 1000);
  const h1 = crypto.createHmac('sha256', SECRET).update(ts + ':' + body).digest('hex');
  assert.equal(verifyPaddleSignature(body, `ts=${ts};h1=${h1}`, SECRET, now), true);
  assert.equal(verifyPaddleSignature(body, `ts=${ts};h1=${'0'.repeat(64)};h1=${h1}`, SECRET, now), true);
  assert.equal(verifyPaddleSignature(body + ' ', `ts=${ts};h1=${h1}`, SECRET, now), false);
  assert.equal(verifyPaddleSignature(body, `ts=${ts};h1=${h1}`, SECRET, now + 301_000), false);
  assert.equal(verifyPaddleSignature(body, `h1=${h1}`, SECRET, now), false);
  assert.equal(verifyPaddleSignature(body, undefined, SECRET, now), false);
  assert.equal(verifyPaddleSignature(body, `ts=${ts};h1=${h1}`, '', now), false);
});

test('offer discount (Black Friday): Paddle\'s own status, expiry and usage limit decide who gets it', async () => {
  const { harness: h, paddle, orders } = await setup(false, 'dsc_01testblackfriday');
  try {
    const minute = 60_000;
    const startFor = async (email: string) => {
      const me = await buyer(h, email);
      const r = await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: {} });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body.checkoutId as string;
    };
    // While Paddle says the discount is active: Paddle gets it, the order records it, and the site banner shows its last day.
    h.clock.now = Date.UTC(2026, 10, 28);
    const during = await startFor('friday@example.test');
    assert.equal(paddle.txns.get(during)!.discount_id, 'dsc_01testblackfriday');
    assert.equal(orders.get(during)!.discountId, 'dsc_01testblackfriday');
    assert.deepEqual((await h.call('GET', '/v1/billing/offer')).body, { live: true, lastDay: '2026-11-30' });
    // Past Paddle's expiry (even before the next read): full price, no banner.
    h.clock.now = Date.UTC(2026, 11, 1);
    const after = await startFor('late@example.test');
    assert.equal(paddle.txns.get(after)!.discount_id, undefined);
    assert.equal(orders.get(after)!.discountId, undefined);
    assert.deepEqual((await h.call('GET', '/v1/billing/offer')).body, { live: false, lastDay: null });
    // Switched off (archived) or used up in Paddle: full price once the five-minute read is due.
    paddle.discount.expires_at = null;
    h.clock.now += 5 * minute;
    assert.equal((await h.call('GET', '/v1/billing/offer')).body.live, true);
    paddle.discount.status = 'archived';
    h.clock.now += 5 * minute;
    assert.equal(paddle.txns.get(await startFor('archived@example.test'))!.discount_id, undefined);
    paddle.discount.status = 'active';
    paddle.discount.usage_limit = 10;
    paddle.discount.times_used = 10;
    h.clock.now += 5 * minute;
    assert.equal(paddle.txns.get(await startFor('spent@example.test'))!.discount_id, undefined);
    // Paddle unreachable: full price, and checkout still opens.
    paddle.discount.fail = true;
    h.clock.now += 5 * minute;
    assert.equal(paddle.txns.get(await startFor('offline@example.test'))!.discount_id, undefined);
  } finally { await h.close(); }
});

test('no offer discount set: full price and no banner', async () => {
  const { harness: h } = await setup();
  try { assert.deepEqual((await h.call('GET', '/v1/billing/offer')).body, { live: false, lastDay: null }); } finally { await h.close(); }
});

const subscriptionEvent = (type: string, id: string, n = 0) => ({ event_id: 'evt_' + type + '_' + id + '_' + n, event_type: type, occurred_at: '2026-11-18T12:00:00Z', data: { id } });
const device = async (accountId: string, h: Harness, hash = 'e') => h.call('POST', '/v1/me/activate', { token: (await h.app.issueSession(accountId, 'user')).accessToken, body: { deviceHash: hash.repeat(64), platform: 'web', appVersion: '1.0.0' } });

test('a subscription renews, falls behind, then ends: Pro follows Paddle and the account drops to Basic', async () => {
  const { harness: h, paddle, ledger, webhook, subscriptions } = await setup();
  try {
    const me = await buyer(h, 'renews@example.test');
    const id = (await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: { plan: 'monthly' } })).body.checkoutId;
    paddle.txns.get(id)!.status = 'completed';
    assert.equal((await webhook(completed(id))).status, 200);
    const [sub] = [...subscriptions.values()];
    assert.ok(sub);
    assert.equal(sub.accountId, me.accountId);
    const licence = async () => (await h.app.store.listLicencesForAccount(me.accountId))[0]!;
    const firstEnd = Date.UTC(2026, 11, 18, 12);
    const secondEnd = Date.UTC(2027, 0, 18, 12);
    assert.equal((await licence()).validUntilMs, firstEnd + SUBSCRIPTION_GRACE_DAYS * DAY);

    // Renewal: Paddle bills a new transaction on the subscription and moves the period on.
    paddle.subs.get(sub.subscriptionId)!.ends_at = new Date(secondEnd).toISOString();
    const renewal = 'txn_01renewal000001';
    paddle.txns.set(renewal, { custom_data: paddle.txns.get(id)!.custom_data, price: PRICE, status: 'completed', subscription_id: sub.subscriptionId });
    h.clock.now = firstEnd;
    const r = await webhook({ ...completed(renewal), data: { id: renewal, subscription_id: sub.subscriptionId } });
    assert.equal(r.status, 200);
    assert.equal(ledger.size, 2, 'each renewal is its own sale');
    assert.ok(ledger.has('paddle_' + renewal));
    assert.equal((await licence()).validUntilMs, secondEnd + SUBSCRIPTION_GRACE_DAYS * DAY);
    assert.equal((await device(me.accountId, h)).status, 200);

    // Past due: Paddle is retrying the card. Pro carries on through the grace, then stops if nothing is paid.
    paddle.subs.get(sub.subscriptionId)!.status = 'past_due';
    assert.deepEqual((await webhook(subscriptionEvent('subscription.past_due', sub.subscriptionId))).body, { received: true, outcome: 'synced' });
    assert.equal((await licence()).validUntilMs, secondEnd + SUBSCRIPTION_GRACE_DAYS * DAY);

    // Cancelled: Pro lasts to the end of what was paid for, with no extra grace, then the account is Basic.
    paddle.subs.get(sub.subscriptionId)!.status = 'canceled';
    paddle.subs.get(sub.subscriptionId)!.ends_at = null;
    assert.equal((await webhook(subscriptionEvent('subscription.canceled', sub.subscriptionId))).status, 200);
    assert.equal((await licence()).validUntilMs, secondEnd);
    assert.equal((await licence()).status, 'active', 'never revoked: it simply ends');
    h.clock.now = secondEnd + 60_000;
    const after = await device(me.accountId, h);
    assert.equal(after.status, 403);
    assert.equal(after.body.error.code, 'NO_LICENCE');
    assert.match(after.body.error.message, /local work is unaffected/);

    // Basic again, so they can subscribe again.
    const again = await h.call('POST', '/v1/me/checkout/pro', { token: (await h.app.issueSession(me.accountId, 'user')).accessToken, body: { plan: 'annual' } });
    assert.equal(again.status, 201, JSON.stringify(again.body));
  } finally { await h.close(); }
});

test('annual plan: the annual price, a year of Pro; an unknown plan is refused', async () => {
  const { harness: h, paddle, orders, webhook } = await setup();
  try {
    const me = await buyer(h, 'annual@example.test');
    assert.equal((await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: { plan: 'lifetime' } })).status, 400);
    const start = await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: { plan: 'annual' } });
    assert.equal(start.status, 201);
    assert.equal(start.body.plan, 'annual');
    const id = start.body.checkoutId;
    assert.equal(paddle.txns.get(id)!.price, ANNUAL);
    assert.equal(orders.get(id)!.plan, 'annual');
    paddle.txns.get(id)!.status = 'completed';
    assert.equal((await webhook(completed(id))).status, 200);
    const [licence] = await h.app.store.listLicencesForAccount(me.accountId);
    assert.equal(licence!.validUntilMs, Date.UTC(2027, 10, 18, 12) + SUBSCRIPTION_GRACE_DAYS * DAY);
  } finally { await h.close(); }
});

test('a one-off licence sold before 26 Nov 2026 still settles and never ends', async () => {
  const { harness: h, paddle, orders, webhook } = await setup();
  try {
    const me = await buyer(h, 'lifetime@example.test');
    const account = await h.app.store.getAccount(me.accountId);
    const id = 'txn_01oldoneoff00001';
    const reference = 'paddle_' + 'a'.repeat(24);
    orders.set(id, { transactionId: id, createdAt: '2026-11-20T10:00:00Z', reference, accountId: me.accountId, emailHash: account!.emailHash!, majorVersion: 1, invoiceNumber: 'INF-20261120-AAAAAAAAAA', priceId: LIFETIME });
    paddle.txns.set(id, { custom_data: { reference, accountId: me.accountId, product: 'pro', majorVersion: '1' }, price: LIFETIME, status: 'completed', subscription_id: null });
    assert.equal((await webhook(completed(id))).status, 200);
    const [licence] = await h.app.store.listLicencesForAccount(me.accountId);
    assert.equal(licence!.validUntilMs, null);
    const activated = await device(me.accountId, h, 'f');
    assert.equal(activated.status, 200);
    assert.deepEqual(activated.body.grant.payload.flags?.['licence.owned'], { on: true });
  } finally { await h.close(); }
});

test('a revoked subscription licence (full refund) is not switched back on by a later subscription update', async () => {
  const { harness: h, paddle, webhook, subscriptions } = await setup();
  try {
    const me = await buyer(h, 'refunded-sub@example.test');
    const id = (await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: {} })).body.checkoutId;
    paddle.txns.get(id)!.status = 'completed';
    await webhook(completed(id));
    const [licence] = await h.app.store.listLicencesForAccount(me.accountId);
    await h.app.store.setLicenceStatus(licence!.licenceId, 'revoked', h.clock.now);
    const [sub] = [...subscriptions.values()];
    paddle.subs.get(sub!.subscriptionId)!.ends_at = new Date(Date.UTC(2027, 0, 18, 12)).toISOString();
    assert.equal((await webhook(subscriptionEvent('subscription.updated', sub!.subscriptionId))).status, 200);
    assert.equal((await h.app.store.getLicence(licence!.licenceId))!.status, 'revoked');
  } finally { await h.close(); }
});

test('Manage or cancel Pro: Paddle pages for this account only; a cancellation ends Pro at the paid-through date', async () => {
  const { harness: h, paddle, webhook, subscriptions } = await setup();
  try {
    const me = await buyer(h, 'canceller@example.test');
    const other = await buyer(h, 'not-a-subscriber@example.test');
    const manage = async (accountId: string) => h.call('POST', '/v1/me/subscription/manage', { token: (await h.app.issueSession(accountId, 'user')).accessToken });
    assert.equal((await manage(me.accountId)).body.error.code, 'NO_SUBSCRIPTION', 'Basic has nothing to cancel');
    const id = (await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: { plan: 'monthly' } })).body.checkoutId;
    paddle.txns.get(id)!.status = 'completed';
    await webhook(completed(id));
    const firstEnd = Date.UTC(2026, 11, 18, 12);
    const open = await manage(me.accountId);
    assert.equal(open.status, 200, JSON.stringify(open.body));
    assert.deepEqual(open.body, { plan: 'monthly', state: 'renewing', paidThroughMs: firstEnd,
      manageUrl: 'https://sandbox-customer-portal.paddle.com/cpl_test/overview', cancelUrl: 'https://sandbox-customer-portal.paddle.com/cpl_test/cancel', paymentUrl: 'https://sandbox-customer-portal.paddle.com/cpl_test/card' });
    assert.equal((await manage(other.accountId)).status, 404, 'another account never sees it');
    assert.equal((await h.call('POST', '/v1/me/subscription/manage')).status, 401);

    // The person cancels on Paddle's page: Paddle schedules it for the end of the period and tells us.
    const [sub] = [...subscriptions.values()];
    paddle.subs.get(sub!.subscriptionId)!.scheduled = { action: 'cancel', effective_at: new Date(firstEnd).toISOString() };
    await webhook(subscriptionEvent('subscription.updated', sub!.subscriptionId, 1));
    const [licence] = await h.app.store.listLicencesForAccount(me.accountId);
    assert.equal(licence!.validUntilMs, firstEnd, 'no extra grace once cancelled');
    assert.equal((await manage(me.accountId)).body.state, 'ending');
  } finally { await h.close(); }
});
