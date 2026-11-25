import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { paddleApi, verifyPaddleSignature } from '../src/commerce/paddle.ts';
import { paddleProCheckout, type PaddleProOrder, type PaddleSaleRecord } from '../src/commerce/paddleCheckout.ts';
import { startHarness, type Harness } from './helpers.ts';

const SECRET = 'pdl_ntfset_test_secret';
const PRICE = 'pri_01m89n5n280m10rr4nbbrj8td9';
const sign = (body: string, ts: number, secret = SECRET) =>
  `ts=${ts};h1=${createHmac('sha256', secret).update(ts + ':' + body).digest('hex')}`;

test('Paddle signatures: right secret and fresh timestamp only', () => {
  const body = '{"event_id":"evt_1"}';
  const now = Date.UTC(2026, 10, 25, 15);
  const ts = now / 1000;
  assert.equal(verifyPaddleSignature(body, sign(body, ts), SECRET, now), true);
  assert.equal(verifyPaddleSignature(body + ' ', sign(body, ts), SECRET, now), false, 'body changed');
  assert.equal(verifyPaddleSignature(body, sign(body, ts, 'other'), SECRET, now), false, 'wrong secret');
  assert.equal(verifyPaddleSignature(body, sign(body, ts - 301), SECRET, now), false, 'replayed later');
  assert.equal(verifyPaddleSignature(body, `ts=${ts};h1=${'0'.repeat(64)};` + sign(body, ts).split(';')[1], SECRET, now), true, 'rotation: any h1');
  assert.equal(verifyPaddleSignature(body, undefined, SECRET, now), false);
  assert.equal(verifyPaddleSignature(body, 'ts=abc;h1=zz', SECRET, now), false);
});

/** A fake Paddle API: one transaction store; tests decide when it is paid and what it says. */
function fakePaddle() {
  const txns = new Map<string, any>();
  const state = { patched: null as any, creates: 0 };
  let n = 0;
  const request = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    assert.equal(u.origin, 'https://api.paddle.com');
    assert.match(String((init?.headers as Record<string, string>).Authorization), /^Bearer /);
    if (u.pathname === '/transactions' && init?.method === 'POST') {
      state.creates++;
      const body = JSON.parse(String(init.body));
      const id = 'txn_' + String(++n).padStart(26, '0');
      txns.set(id, {
        id, status: 'ready', currency_code: 'GBP', custom_data: body.custom_data, billed_at: null,
        items: [{ price: { id: body.items[0].price_id }, quantity: body.items[0].quantity }],
        details: { totals: { subtotal: '2900', tax: '0', total: '2900' } },
        checkout: { url: 'https://inflight.example/checkout?_ptxn=' + id },
      });
      return Response.json({ data: txns.get(id) });
    }
    if (u.pathname.startsWith('/transactions/')) {
      const t = txns.get(u.pathname.split('/').pop()!);
      return t ? Response.json({ data: t }) : new Response('{}', { status: 404 });
    }
    if (u.pathname.startsWith('/prices/') && init?.method === 'PATCH') {
      state.patched = { id: u.pathname.split('/').pop(), body: JSON.parse(String(init.body)) };
      return Response.json({ data: {} });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { request, txns, state, pay(id: string) { Object.assign(txns.get(id), { status: 'completed', billed_at: '2026-11-18T12:00:00Z', address: { country_code: 'FR' }, details: { totals: { subtotal: '2900', tax: '580', total: '3480' } } }); } };
}

async function harnessWithPaddle(review?: unknown) {
  const fake = fakePaddle();
  const api = paddleApi({ apiKey: 'pdl_live_apikey_test' }, fake.request);
  const orders = new Map<string, PaddleProOrder>();
  const sales = new Map<string, PaddleSaleRecord>();
  const events = new Set<string>();
  let h: Harness;
  const checkout = paddleProCheckout({
    api, proPriceId: PRICE, now: () => h.clock.now,
    orders: { save: async (o) => { orders.set(o.transactionId, o); }, get: async (id) => orders.get(id) ?? null },
    recordSale: async (s) => { if (!sales.has(s.reference)) sales.set(s.reference, s); return sales.get(s.reference)!; },
    licences: { getAccount: (id) => h.app.store.getAccount(id), grantLicence: (l) => h.app.store.grantLicence(l), listLicencesForAccount: (id) => h.app.store.listLicencesForAccount(id) },
  });
  h = await startHarness(null, undefined, {
    pricing: { latestPriceReview: async () => review as any },
    paddle: {
      checkout, api, webhookSecret: SECRET, proPriceId: PRICE, sales: { listPaddleSales: async () => [...sales.values()] },
      rememberEvent: async (id) => { const fresh = !events.has(id); events.add(id); return fresh; },
    },
  });
  return { h, fake, orders, sales, events };
}

test('Paddle: buy Pro, a signed notification grants it once, after reading the transaction back', async () => {
  const { h, fake, sales, events } = await harnessWithPaddle();
  try {
    const accountId = await h.app.createAccount('buyer@example.test', 'test-password-with-length', 'user');
    const token = (await h.app.issueSession(accountId, 'user')).accessToken;
    const started = await h.call('POST', '/v1/me/checkout/pro', { token, body: { country: 'FR' } });
    assert.equal(started.status, 201, JSON.stringify(started.body));
    const id = started.body.checkoutId as string;
    assert.match(id, /^txn_/);
    assert.equal(started.body.url, 'https://inflight.example/checkout?_ptxn=' + id);

    const notify = (eventType: string, dataId: string, signature?: string) => {
      const raw = JSON.stringify({ event_id: 'evt_' + 'a'.repeat(26), event_type: eventType, occurred_at: '2026-11-18T12:00:00Z', data: { id: dataId } });
      return h.call('POST', '/v1/billing/paddle', { raw, headers: { 'content-type': 'application/json', 'paddle-signature': signature ?? sign(raw, Math.floor(h.clock.now / 1000)) } });
    };
    assert.equal((await notify('transaction.completed', id, 'ts=1;h1=' + '0'.repeat(64))).status, 401, 'unsigned');
    assert.equal((await notify('transaction.completed', id)).status, 200, 'not paid yet: nothing granted');
    assert.equal(sales.size, 0);
    assert.equal((await h.call('GET', '/v1/me/checkout/pro/' + id, { token })).body.status, 'pending');

    fake.pay(id);
    assert.equal((await notify('transaction.completed', id)).status, 200);
    assert.equal((await notify('transaction.completed', id)).status, 200, 'replay is harmless');
    assert.equal(sales.size, 1);
    const sale = [...sales.values()][0];
    assert.deepEqual([sale.currency, sale.totalMinor, sale.taxMinor, sale.country], ['GBP', 3480, 580, 'FR']);
    assert.equal((await h.call('GET', '/v1/me/checkout/pro/' + id, { token })).body.status, 'paid');
    const licences = await h.app.store.listLicencesForAccount(accountId);
    assert.equal(licences.filter((l) => l.paid).length, 1);
    assert.ok(events.size >= 1);

    // Someone else cannot see or claim this transaction.
    const other = await h.app.createAccount('other@example.test', 'test-password-with-length', 'user');
    const otherToken = (await h.app.issueSession(other, 'user')).accessToken;
    assert.equal((await h.call('GET', '/v1/me/checkout/pro/' + id, { token: otherToken })).status, 404);
  } finally { await h.close(); }
});

test('Paddle: a transaction that does not match the order grants nothing', async () => {
  const { h, fake, sales } = await harnessWithPaddle();
  try {
    const accountId = await h.app.createAccount('buyer@example.test', 'test-password-with-length', 'user');
    const token = (await h.app.issueSession(accountId, 'user')).accessToken;
    const id = (await h.call('POST', '/v1/me/checkout/pro', { token, body: { country: 'GB' } })).body.checkoutId as string;
    fake.pay(id);
    fake.txns.get(id).items[0].price.id = 'pri_' + 'z'.repeat(26);
    assert.equal((await h.call('GET', '/v1/me/checkout/pro/' + id, { token })).status, 503);
    assert.equal(sales.size, 0);
    assert.equal((await h.app.store.listLicencesForAccount(accountId)).filter((l) => l.paid).length, 0);
  } finally { await h.close(); }
});

test('Paddle: the admin pushes the reviewed prices to the Pro price, only for the month they saw', async () => {
  const review = {
    month: '2026-11', proposedGbpPence: 2900,
    prices: [
      { currency: 'GBP', status: 'for-review', proposedMajor: 29 },
      { currency: 'EUR', status: 'for-review', proposedMajor: 33 },
      { currency: 'USD', status: 'for-review', proposedMajor: 37 },
      { currency: 'ISK', status: 'for-review', proposedMajor: 5000 },
      { currency: 'JPY', status: 'missing-rate' },
    ],
  };
  const { h, fake } = await harnessWithPaddle(review);
  try {
    assert.equal((await h.call('POST', '/v1/admin/pricing/paddle', { token: h.user.token, body: { month: '2026-11' } })).status, 403);
    assert.equal((await h.call('POST', '/v1/admin/pricing/paddle', { token: h.adminToken, body: { month: '2026-10' } })).status, 409);
    assert.equal(fake.state.patched, null);
    const pushed = await h.call('POST', '/v1/admin/pricing/paddle', { token: h.adminToken, body: { month: '2026-11' } });
    assert.equal(pushed.status, 200, JSON.stringify(pushed.body));
    assert.equal(pushed.body.localPrices, 2, 'ISK and missing rates are skipped');
    assert.equal(fake.state.patched.id, PRICE);
    assert.deepEqual(fake.state.patched.body.unit_price, { amount: '2900', currency_code: 'GBP' });
    const eur = fake.state.patched.body.unit_price_overrides.find((o: any) => o.unit_price.currency_code === 'EUR');
    assert.equal(eur.unit_price.amount, '3300');
    assert.ok(eur.country_codes.includes('DE') && eur.country_codes.includes('IE'));
  } finally { await h.close(); }
});
