import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { MemoryCloudBalance } from '../src/cloudBalance.ts';
import { paddleApi } from '../src/commerce/paddle.ts';
import { paddleTopUps, type TopUpOrder } from '../src/commerce/topUpCheckout.ts';
import type { TransactionRecord } from '../src/commerce/records.ts';
import { startHarness } from './helpers.ts';

const SECRET = 'pdl_ntfset_test_only_secret';
const PRICES = { 500: 'pri_01testtopupfive', 1000: 'pri_01testtopupten', 2000: 'pri_01testtopuptwenty' } as const;

function fakePaddle() {
  const txns = new Map<string, { custom_data: Record<string, string>; price: string; status: string; subscription_id?: string | null }>();
  const request = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.pathname === '/transactions' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      const id = 'txn_01topup' + String(txns.size).padStart(6, '0');
      txns.set(id, { custom_data: body.custom_data, price: body.items[0].price_id, status: 'ready' });
      return Response.json({ data: view(id) }, { status: 201 });
    }
    const id = decodeURIComponent(u.pathname.split('/').pop()!);
    return txns.has(id) ? Response.json({ data: view(id) }) : new Response(null, { status: 404 });
  }) as typeof fetch;
  const view = (id: string) => {
    const t = txns.get(id)!;
    const done = t.status === 'completed';
    return {
      id, status: t.status, currency_code: 'GBP', custom_data: t.custom_data, subscription_id: t.subscription_id ?? null,
      billed_at: done ? '2026-11-26T12:00:00Z' : null, updated_at: '2026-11-26T12:00:00Z',
      items: [{ price: { id: t.price }, quantity: 1 }],
      details: { totals: { subtotal: '833', tax: '167', total: '1000', currency_code: 'GBP' },
        payout_totals: done ? { subtotal: '833', tax: '167', total: '1000', fee: '100', earnings: '733', currency_code: 'GBP' } : null },
      checkout: { url: 'https://site.example.test/pro-checkout?_ptxn=' + id },
      address: { country_code: 'GB' },
    };
  };
  return { request, txns };
}

async function setup(requireAdminSwitch = false) {
  const paddle = fakePaddle();
  const balance = new MemoryCloudBalance();
  const orders = new Map<string, TopUpOrder>();
  const ledger = new Map<string, TransactionRecord>();
  const topUps = paddleTopUps({
    paddle: paddleApi({ apiKey: 'test-only-key', environment: 'sandbox' }, paddle.request),
    orders: { save: async (o) => { assert.ok(!orders.has(o.transactionId)); orders.set(o.transactionId, o); }, get: async (id) => orders.get(id) ?? null },
    priceIds: PRICES,
    checkoutUrl: 'https://site.example.test/pro-checkout',
    commerce: { recordPaid: async (r) => { if (!ledger.has(r.checkoutReference)) ledger.set(r.checkoutReference, r); return ledger.get(r.checkoutReference)!; } },
    balance,
  });
  const harness = await startHarness(null, undefined, {
    requireAdminSwitch, paddleWebhookSecret: SECRET, topUpCheckout: topUps,
    settlePaddle: async (id) => topUps.settle(id),
  });
  const webhook = (id: string) => {
    const raw = JSON.stringify({ event_id: 'evt_' + id, event_type: 'transaction.completed', occurred_at: '2026-11-26T12:00:00Z', data: { id } });
    const ts = String(Math.floor(harness.clock.now / 1000));
    const h1 = crypto.createHmac('sha256', SECRET).update(ts + ':' + raw).digest('hex');
    return harness.call('POST', '/v1/billing/paddle', { raw, headers: { 'content-type': 'application/json', 'paddle-signature': `ts=${ts};h1=${h1}` } });
  };
  return { h: harness, paddle, balance, orders, ledger, webhook };
}

test('a top-up: server-priced, bound to the account, credited once after Paddle confirms it', async () => {
  const { h, paddle, balance, orders, ledger, webhook } = await setup();
  try {
    const accountId = await h.app.createAccount('topper@example.test', 'test-password-with-length', 'user');
    const token = (await h.app.issueSession(accountId, 'user')).accessToken;
    assert.equal((await h.call('POST', '/v1/me/checkout/topup', { token, body: { pence: 700 } })).status, 400, 'only £5, £10 or £20');
    const start = await h.call('POST', '/v1/me/checkout/topup', { token, body: { pence: 1000 } });
    assert.equal(start.status, 201, JSON.stringify(start.body));
    const id = start.body.checkoutId;
    assert.equal(paddle.txns.get(id)!.price, PRICES[1000]);
    assert.deepEqual(paddle.txns.get(id)!.custom_data, { reference: orders.get(id)!.reference, accountId, product: 'cloud-top-up', pence: '1000' });
    const status = () => h.call('GET', '/v1/me/checkout/topup/' + id, { token });
    assert.deepEqual((await status()).body, { status: 'pending' });
    assert.equal(await balance.millicredits(accountId), 0);

    paddle.txns.get(id)!.status = 'completed';
    assert.equal((await webhook(id)).status, 200);
    assert.equal((await webhook(id)).status, 200, 'a repeated notification is harmless');
    assert.deepEqual((await status()).body, { status: 'paid' });
    assert.equal(await balance.millicredits(accountId), 1000 * 1000, '£10 adds 1,000 credits, once');
    assert.equal(ledger.size, 1);
    assert.equal([...ledger.values()][0]!.netPence, 733, 'our turnover is what Paddle pays out');

    // Someone else's checkout looks like none; a mismatched price never credits.
    const otherId = await h.app.createAccount('nosy@example.test', 'test-password-with-length', 'user');
    assert.equal((await h.call('GET', '/v1/me/checkout/topup/' + id, { token: (await h.app.issueSession(otherId, 'user')).accessToken })).status, 404);
    const second = (await h.call('POST', '/v1/me/checkout/topup', { token, body: { pence: 500 } })).body.checkoutId;
    Object.assign(paddle.txns.get(second)!, { status: 'completed', price: PRICES[2000] });
    assert.equal((await webhook(second)).status, 503);
    assert.equal(await balance.millicredits(accountId), 1000 * 1000);
  } finally { await h.close(); }
});

test('production: top-ups stay off until the admin switches them on', async () => {
  const { h } = await setup(true);
  try {
    const accountId = await h.app.createAccount('early-topper@example.test', 'test-password-with-length', 'user');
    const token = (await h.app.issueSession(accountId, 'user')).accessToken;
    const off = await h.call('POST', '/v1/me/checkout/topup', { token, body: { pence: 500 } });
    assert.equal(off.status, 503);
    assert.equal(off.body.error.code, 'CHECKOUT_DISABLED');
    assert.equal((await h.call('POST', '/v1/admin/switches/set', { token: h.adminToken, body: { key: 'cloud-top-ups', on: true } })).status, 200);
    assert.equal((await h.call('POST', '/v1/me/checkout/topup', { token, body: { pence: 500 } })).status, 201);
  } finally { await h.close(); }
});
