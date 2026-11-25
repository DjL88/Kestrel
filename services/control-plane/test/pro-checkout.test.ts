import assert from 'node:assert/strict';
import test from 'node:test';
import { sumupProCheckout, type StoredProOrder } from '../src/commerce/proCheckout.ts';
import { sumupProSettlement } from '../src/commerce/proSettlement.ts';
import type { TransactionRecord } from '../src/commerce/records.ts';
import { sumupCheckouts } from '../src/commerce/sumup.ts';
import { networkCountryFrom } from '../src/networkCountry.ts';

const places: Record<string, string> = { GB: '81.2.69.142', FR: '2.2.2.2', US: '3.3.3.3' };
const from = (country: string) => ({ 'x-forwarded-for': '9.9.9.9, ' + places[country] });
import { startHarness, type Harness } from './helpers.ts';

const merchantCode = 'TESTMERCHANT';

/** A fake SumUp: records created checkouts; tests decide what "paid" looks like. */
function fakeSumup() {
  const checkouts = new Map<string, { reference: string; amount: number }>();
  const state = { paid: false, paidAmount: null as number | null, refunded: false, creates: 0 };
  const request = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v0.1/checkouts' && init?.method === 'POST') {
      state.creates++;
      const body = JSON.parse(String(init.body));
      const id = 'chk-' + checkouts.size;
      checkouts.set(id, { reference: body.checkout_reference, amount: body.amount });
      return Response.json({ id, status: 'PENDING', checkout_reference: body.checkout_reference, amount: body.amount, currency: body.currency, merchant_code: body.merchant_code, hosted_checkout_url: 'https://checkout.sumup.example/' + id });
    }
    const id = decodeURIComponent(path.split('/').pop()!);
    if (path.startsWith('/v0.1/checkouts/')) {
      const c = checkouts.get(id);
      if (!c) return new Response(null, { status: 404 });
      return Response.json({ id, status: state.paid ? 'PAID' : 'PENDING', checkout_reference: c.reference, amount: c.amount, currency: 'GBP', merchant_code: merchantCode, ...(state.paid ? { transaction_id: 'txn-' + id } : {}) });
    }
    const txn = new URL(String(url)).searchParams.get('id')!;
    const c = checkouts.get(txn.slice(4))!;
    return Response.json({ id: txn, status: 'SUCCESSFUL', amount: state.paidAmount ?? c.amount, currency: 'GBP', merchant_code: merchantCode, timestamp: '2026-11-18T12:00:00+00:00', ...(state.refunded ? { simple_status: 'REFUNDED' } : {}) });
  }) as typeof fetch;
  return { request, state, checkouts };
}

async function setup(requireAdminSwitch = false) {
  const sumup = fakeSumup();
  let bound: ReturnType<typeof sumupProCheckout> | undefined;
  const harness = await startHarness(null, undefined, {
    requireAdminSwitch,
    networkCountry: networkCountryFrom((ip) => Object.keys(places).find((c) => places[c] === ip) ?? null),
    proCheckout: { start: (input) => bound!.start(input), status: (input) => bound!.status(input) },
  });
  const orders = new Map<string, StoredProOrder>();
  const ledger = new Map<string, TransactionRecord>();
  const adapter = sumupCheckouts({ apiKey: 'test-only-key', merchantCode }, sumup.request);
  const settle = sumupProSettlement({
    findOrder: async (id) => orders.get(id) ?? null,
    checkouts: adapter,
    commerce: { recordPaid: async (r) => { if (!ledger.has(r.checkoutReference)) ledger.set(r.checkoutReference, r); return ledger.get(r.checkoutReference)!; } },
    licences: harness.app.store,
  });
  bound = sumupProCheckout({
    checkouts: adapter,
    orders: { save: async (o) => { assert.ok(!orders.has(o.checkoutId)); orders.set(o.checkoutId, o); }, get: async (id) => orders.get(id) ?? null },
    taxSettings: async () => ({ ukVatRegistered: false, b2cPricing: 'inclusive', localTaxes: {} }),
    settle,
    hasPaidLicence: async (accountId, licenceId) => (await harness.app.store.listLicencesForAccount(accountId)).some((l) => l.licenceId === licenceId && l.paid),
    redirectUrl: 'https://site.example.test/pro-complete',
    now: () => harness.clock.now,
  });
  return { harness, sumup, orders, ledger };
}

async function buyer(h: Harness, email: string) {
  const accountId = await h.app.createAccount(email, 'test-password-with-length', 'user');
  return { accountId, token: (await h.app.issueSession(accountId, 'user')).accessToken };
}

test('UK buyer: server-priced checkout, verified payment, one paid Pro grant, then offline activation', async () => {
  const { harness: h, sumup, orders, ledger } = await setup();
  try {
    const me = await buyer(h, 'buyer@example.test');
    const start = await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: { country: 'GB' }, headers: from('GB') });
    assert.equal(start.status, 201, JSON.stringify(start.body));
    assert.equal(start.body.url, 'https://checkout.sumup.example/chk-0');
    assert.equal(start.body.totalPence, 2900);
    assert.equal(sumup.checkouts.get('chk-0')!.amount, 29);
    const order = orders.get('chk-0')!;
    assert.equal(order.accountId, me.accountId);
    assert.equal(order.majorVersion, 1);
    assert.equal(order.quote.treatment, 'uk-unregistered');

    const status = () => h.call('GET', '/v1/me/checkout/pro/chk-0', { token: me.token });
    const activate = () => h.call('POST', '/v1/me/activate', { token: me.token, body: { deviceHash: 'b'.repeat(64), platform: 'web', appVersion: '1.0.0' } });
    assert.deepEqual((await status()).body, { status: 'pending' });
    assert.equal((await activate()).status, 403);

    sumup.state.paid = true;
    assert.deepEqual((await status()).body, { status: 'paid' });
    assert.deepEqual((await status()).body, { status: 'paid' });
    assert.equal(ledger.size, 1);
    assert.equal((await h.app.store.listLicencesForAccount(me.accountId)).length, 1);
    assert.equal((await activate()).status, 200);

    const again = await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: { country: 'GB' }, headers: from('GB') });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'ALREADY_PRO');
    assert.equal(sumup.state.creates, 1);
  } finally { await h.close(); }
});

test('another account cannot see or settle someone else\'s checkout; odd IDs are not found', async () => {
  const { harness: h } = await setup();
  try {
    const me = await buyer(h, 'owner-of-order@example.test');
    const other = await buyer(h, 'someone-else@example.test');
    assert.equal((await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: { country: 'GB' }, headers: from('GB') })).status, 201);
    assert.equal((await h.call('GET', '/v1/me/checkout/pro/chk-0', { token: other.token })).status, 404);
    assert.equal((await h.call('GET', '/v1/me/checkout/pro/..%2Fx', { token: me.token })).status, 404);
    assert.equal((await h.call('GET', '/v1/me/checkout/pro/chk-0')).status, 401);
  } finally { await h.close(); }
});

test('worldwide: billing country must match the network location; EU VAT included; the client cannot set an amount', async () => {
  const { harness: h, sumup, orders } = await setup();
  try {
    const me = await buyer(h, 'world@example.test');
    const post = (country: string, headers: Record<string, string>) => h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: { country }, headers });
    const vpn = await post('GB', from('FR'));
    assert.equal(vpn.status, 409);
    assert.equal(vpn.body.error.code, 'LOCATION_UNCONFIRMED');
    assert.equal((await post('GB', {})).body.error.code, 'LOCATION_UNCONFIRMED');
    assert.equal((await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: { country: 'GB', totalPence: 1 }, headers: from('GB') })).status, 400);
    assert.equal(sumup.state.creates, 0);

    assert.equal((await post('US', from('US'))).status, 201);
    assert.equal(orders.get('chk-0')!.quote.treatment, 'outside-uk-vat');
    assert.deepEqual(orders.get('chk-0')!.quote.evidence.map((e) => e.source + ':' + e.country), ['billing-address:US', 'ip-geolocation:US']);
    const fr = await post('FR', from('FR'));
    assert.equal(fr.status, 201);
    assert.equal(orders.get('chk-1')!.quote.treatment, 'eu-oss');
    assert.equal(orders.get('chk-1')!.quote.rateBasisPoints, 2000);
    assert.equal(fr.body.totalPence, 2900);
  } finally { await h.close(); }
});

test('wrong paid amount or a refund never grants Pro', async () => {
  const { harness: h, sumup } = await setup();
  try {
    const me = await buyer(h, 'mismatch@example.test');
    await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: { country: 'GB' }, headers: from('GB') });
    sumup.state.paid = true;
    sumup.state.paidAmount = 1;
    assert.equal((await h.call('GET', '/v1/me/checkout/pro/chk-0', { token: me.token })).status, 503);
    sumup.state.paidAmount = null;
    sumup.state.refunded = true;
    assert.deepEqual((await h.call('GET', '/v1/me/checkout/pro/chk-0', { token: me.token })).body, { status: 'pending' });
    assert.equal((await h.app.store.listLicencesForAccount(me.accountId)).length, 0);
  } finally { await h.close(); }
});

test('production: checkout stays off until the admin switches it on (audited)', async () => {
  const { harness: h, sumup } = await setup(true);
  try {
    const me = await buyer(h, 'early@example.test');
    const off = await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: { country: 'GB' }, headers: from('GB') });
    assert.equal(off.status, 503);
    assert.equal(off.body.error.code, 'CHECKOUT_DISABLED');
    const switches = await h.call('GET', '/v1/admin/switches', { token: h.adminToken });
    assert.deepEqual(switches.body.switches.find((s: { key: string }) => s.key === 'pro-checkout'), {
      key: 'pro-checkout', label: 'Pro checkout (SumUp)', note: switches.body.switches.find((s: { key: string }) => s.key === 'pro-checkout').note, on: false, configured: true,
    });
    assert.equal((await h.call('POST', '/v1/admin/switches/set', { token: h.adminToken, body: { key: 'pro-checkout', on: true } })).status, 200);
    const eu = await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: { country: 'FR' }, headers: from('FR') });
    assert.equal(eu.status, 409);
    assert.equal(eu.body.error.code, 'COUNTRY_UNAVAILABLE');
    assert.equal((await h.call('POST', '/v1/me/checkout/pro', { token: me.token, body: { country: 'GB' }, headers: from('GB') })).status, 201);
    assert.equal(sumup.state.creates, 1);
  } finally { await h.close(); }
});
