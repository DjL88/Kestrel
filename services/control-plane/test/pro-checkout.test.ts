import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { paddleApi, verifyPaddleSignature } from '../src/commerce/paddle.ts';
import { paddleProCheckout, type StoredProOrder } from '../src/commerce/proCheckout.ts';
import { paddleProSettlement } from '../src/commerce/proSettlement.ts';
import type { TransactionRecord } from '../src/commerce/records.ts';
import { startHarness, type Harness } from './helpers.ts';

const PRICE = 'pri_01testlifetimepro';
const SECRET = 'pdl_ntfset_test_only_secret';

/** A fake Paddle sandbox: records created transactions; tests decide when one is completed. */
function fakePaddle() {
  const txns = new Map<string, { custom_data: Record<string, string>; price: string; status: string; subscription_id?: string; discount_id?: string }>();
  const state = { creates: 0, gets: 0, failGets: false };
  const view = (id: string) => {
    const t = txns.get(id)!;
    const done = t.status === 'completed';
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
    state.gets++;
    if (state.failGets) return new Response(null, { status: 500 });
    assert.equal(u.searchParams.get('include'), 'address');
    const id = decodeURIComponent(u.pathname.split('/').pop()!);
    return txns.has(id) ? Response.json({ data: view(id) }) : new Response(null, { status: 404 });
  }) as typeof fetch;
  return { request, state, txns };
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
  let settle: ReturnType<typeof paddleProSettlement> | undefined;
  const harness = await startHarness(null, undefined, {
    requireAdminSwitch,
    settlePaddle: (id) => settle!(id),
    paddleWebhookSecret: SECRET,
    paddleClient: { environment: 'sandbox', clientToken: 'test_clienttoken' },
    proCheckout: { start: (input) => bound!.start(input), status: (input) => bound!.status(input) },
  });
  const orders = new Map<string, StoredProOrder>();
  const ledger = new Map<string, TransactionRecord>();
  const api = paddleApi({ apiKey: 'test-only-key', environment: 'sandbox' }, paddle.request);
  settle = paddleProSettlement({
    findOrder: async (id) => orders.get(id) ?? null,
    paddle: api,
    commerce: { recordPaid: async (r) => { if (!ledger.has(r.checkoutReference)) ledger.set(r.checkoutReference, r); return ledger.get(r.checkoutReference)!; } },
    licences: harness.app.store,
  });
  bound = paddleProCheckout({
    paddle: api,
    orders: { save: async (o) => { assert.ok(!orders.has(o.transactionId)); orders.set(o.transactionId, o); }, get: async (id) => orders.get(id) ?? null },
    priceId: PRICE,
    checkoutUrl: 'https://site.example.test/pro-checkout',
    settle,
    promoDiscountId,
    now: () => harness.clock.now,
  });
  const webhook = (body: unknown, secret?: string) => {
    const s = signed(body, harness.clock.now, secret);
    return harness.call('POST', '/v1/billing/paddle', { raw: s.raw, headers: s.headers });
  };
  return { harness, paddle, orders, ledger, webhook };
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
    assert.deepEqual(paddle.txns.get(id)!.custom_data, { reference: order.reference, accountId: me.accountId, product: 'pro', majorVersion: '1' });

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
    assert.equal((await activate()).status, 200);

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

test('a transaction that does not match the order (price, account, subscription) never grants Pro', async () => {
  const { harness: h, paddle, webhook } = await setup();
  try {
    const me = await buyer(h, 'mismatch@example.test');
    const id = (await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: {} })).body.checkoutId;
    const t = paddle.txns.get(id)!;
    t.status = 'completed';
    t.price = 'pri_01somethingcheaper';
    assert.equal((await webhook(completed(id))).status, 503);
    t.price = PRICE;
    t.custom_data = { ...t.custom_data, accountId: 'someone-else' };
    assert.equal((await webhook(completed(id))).status, 503);
    assert.equal((await h.app.store.listLicencesForAccount(me.accountId)).length, 0);
    // Unknown transactions and subscription events are acknowledged, so Paddle does not retry them for ever.
    assert.equal((await webhook(completed('txn_01unknown000000'))).status, 200);
    assert.equal((await webhook({ event_id: 'evt_s', event_type: 'subscription.created', occurred_at: '2026-11-18T12:00:00Z', data: { id: 'sub_01x' } })).status, 200);
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

test('offer discount (Black Friday): only a checkout started while proPromo is on gets it', async () => {
  const { harness: h, paddle, orders } = await setup(false, 'dsc_01testblackfriday');
  try {
    const day = 86_400_000;
    const startsAtMs = Date.UTC(2026, 10, 27);
    const endsAtMs = startsAtMs + 4 * day;
    const set = await h.call('POST', '/v1/admin/flags/set', { token: h.adminToken, body: { key: 'proPromo', flag: { default: false, rules: [{ audience: { kind: 'any' }, enabled: true, startsAtMs, endsAtMs }] } } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    const startFor = async (email: string) => {
      const me = await buyer(h, email);
      const r = await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: {} });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body.checkoutId as string;
    };
    // Before the offer: full price.
    const before = await startFor('early@example.test');
    assert.equal(paddle.txns.get(before)!.discount_id, undefined);
    assert.equal(orders.get(before)!.discountId, undefined);
    // During the offer: Paddle gets the discount, and the order records it.
    h.clock.now = startsAtMs + 60_000;
    const during = await startFor('friday@example.test');
    assert.equal(paddle.txns.get(during)!.discount_id, 'dsc_01testblackfriday');
    assert.equal(orders.get(during)!.discountId, 'dsc_01testblackfriday');
    // The day after the last day: full price again.
    h.clock.now = endsAtMs;
    const after = await startFor('late@example.test');
    assert.equal(paddle.txns.get(after)!.discount_id, undefined);
  } finally { await h.close(); }
});
