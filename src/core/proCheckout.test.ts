import assert from 'node:assert/strict';
import test from 'node:test';
import { checkoutErrorText, isPaddleCheckoutUrl, keepPolling, parseCheckoutPoll, parseCheckoutStart, priceText, CHECKOUT_POLL_LIMIT_MS, CHECKOUT_POLL_MS } from './proCheckout.ts';

const ID = 'txn_01testcheckout01';
const PAGE = 'https://kestrel-hosting-kestrel.web.app/pro-checkout?_ptxn=txn_01testcheckout01';

test('a started checkout gives the Paddle transaction and our checkout page for it', () => {
  assert.deepEqual(parseCheckoutStart(201, { checkoutId: ID, url: PAGE }), { ok: true, checkoutId: ID, url: PAGE, totalPence: null, currency: null });
  assert.deepEqual(parseCheckoutStart(201, { checkoutId: ID, url: 'https://inflight.studio/pro-checkout?_ptxn=' + ID, totalPence: 2900, currency: 'GBP' }),
    { ok: true, checkoutId: ID, url: 'https://inflight.studio/pro-checkout?_ptxn=' + ID, totalPence: 2900, currency: 'GBP' });
});

test('only our own HTTPS checkout page for that one transaction is ever opened', () => {
  for (const url of [
    'http://kestrel-hosting-kestrel.web.app/pro-checkout?_ptxn=' + ID, 'https://kestrel-hosting-kestrel.web.app.evil.example/pro-checkout?_ptxn=' + ID,
    'https://evil.example/pro-checkout?_ptxn=' + ID, 'https://user:pw@inflight.studio/pro-checkout?_ptxn=' + ID, 'https://inflight.studio/other?_ptxn=' + ID,
    'https://inflight.studio/pro-checkout?_ptxn=../x', 'https://inflight.studio:8443/pro-checkout?_ptxn=' + ID, 'javascript:alert(1)', 42,
  ]) {
    assert.equal(isPaddleCheckoutUrl(url), false, String(url));
    assert.equal(parseCheckoutStart(201, { checkoutId: ID, url }).ok, false);
  }
  assert.equal(parseCheckoutStart(201, { checkoutId: '../x', url: PAGE }).ok, false);
  assert.equal(parseCheckoutStart(201, { checkoutId: 'txn_01someotherorder', url: PAGE }).ok, false, 'the page must be for this transaction');
});

test('each refusal from the server is explained calmly, and says nothing was charged where that matters', () => {
  const refused = (code: string, status = 409) => parseCheckoutStart(status, { error: { code, message: 'server words' } });
  assert.deepEqual(refused('CHECKOUT_DISABLED', 503), { ok: false, code: 'CHECKOUT_DISABLED', message: checkoutErrorText('CHECKOUT_DISABLED') });
  assert.match(refused('CHECKOUT_DISABLED', 503).ok ? '' : (refused('CHECKOUT_DISABLED', 503) as { message: string }).message, /not open yet/);
  assert.match((refused('ALREADY_PRO') as { message: string }).message, /already has Pro/);
  assert.match((parseCheckoutStart(500, null) as { message: string }).message, /Nothing was charged/);
  assert.equal((parseCheckoutStart(500, null) as { code: string }).code, 'UNKNOWN');
});

test('only an explicit paid answer counts as paid', () => {
  assert.equal(parseCheckoutPoll(200, { status: 'paid' }), 'paid');
  assert.equal(parseCheckoutPoll(200, { status: 'pending' }), 'pending');
  assert.equal(parseCheckoutPoll(200, { status: 'PAID' }), 'retry');
  assert.equal(parseCheckoutPoll(503, { status: 'paid' }), 'retry');
  assert.equal(parseCheckoutPoll(429, null), 'retry');
  assert.equal(parseCheckoutPoll(404, null), 'gone');
});

test('checking stays inside the server limit and stops by itself after 20 minutes', () => {
  assert.ok(60_000 / CHECKOUT_POLL_MS < 10);
  assert.equal(keepPolling(0, CHECKOUT_POLL_LIMIT_MS - 1), true);
  assert.equal(keepPolling(0, CHECKOUT_POLL_LIMIT_MS), false);
});

test('a price is shown only when the server gives one', () => {
  assert.equal(priceText(4900, 'GBP', 'en-GB'), '£49.00');
  assert.equal(priceText(null, 'GBP'), null);
});

test('Manage or cancel Pro: only Paddle portal links survive, and every state says what happens next', async () => {
  const { parseSubscriptionManage, subscriptionStateText, isPaddlePortalUrl } = await import('./proCheckout');
  assert.equal(isPaddlePortalUrl('https://customer-portal.paddle.com/cpl_1/overview'), true);
  assert.equal(isPaddlePortalUrl('https://customer-portal.paddle.com.evil.test/x'), false);
  assert.equal(isPaddlePortalUrl('http://customer-portal.paddle.com/x'), false);
  const ok = parseSubscriptionManage(200, { plan: 'monthly', state: 'ending', paidThroughMs: Date.UTC(2026, 11, 18), cancelUrl: 'https://evil.test/cancel', manageUrl: 'https://sandbox-customer-portal.paddle.com/cpl_1/overview' });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.cancelUrl, undefined, 'a link that is not Paddle\'s portal is dropped');
    assert.equal(ok.manageUrl, 'https://sandbox-customer-portal.paddle.com/cpl_1/overview');
    assert.match(subscriptionStateText(ok, 'en-GB'), /Pro lasts until 18 December 2026, then this account goes back to Basic\. Your projects, edits and exports are never locked\./);
    for (const state of ['renewing', 'payment-due', 'paused', 'ended'] as const) assert.ok(subscriptionStateText({ ...ok, state }, 'en-GB').length > 10);
  }
  const none = parseSubscriptionManage(404, { error: { code: 'NO_SUBSCRIPTION' } });
  assert.equal(none.ok, false);
  assert.match(!none.ok ? none.message : '', /no Pro subscription/);
  assert.equal(parseSubscriptionManage(200, { plan: 'lifetime', state: 'renewing' }).ok, false);
});

test('plan choices show the matrix price in the currency Paddle charges for the country', async () => {
  const { proPlanChoices } = await import('./proCheckout.ts');
  const { DEFAULT_PRICING, publicPricing, parsePricingMatrix } = await import('./pricingMatrix.ts');
  const gbp = proPlanChoices(publicPricing(DEFAULT_PRICING), 'FR');
  assert.deepEqual(gbp.map((c) => c.price), ['£2.99 a month', '£29.99 a year', '£9.99 a month', '£99.99 a year'], 'no euro price until the matrix has one');
  const matrix = parsePricingMatrix({ ...DEFAULT_PRICING, rates: { date: '2026-11-25', perGbp: { EUR: 1.17 } }, currencies: { EUR: { rounding: 'charm', overrides: { 'pro.monthly': 349 } } } });
  assert.deepEqual(proPlanChoices(publicPricing(matrix), 'FR').map((c) => c.price), ['€3.49 a month', '€35 a year', '€11.99 a month', '€119 a year']);
});

test('the installed app may open every page it hands out for Pro: our checkout page and Paddle\'s portal, live and sandbox', async () => {
  const { readFileSync } = await import('node:fs');
  const { isPaddlePortalUrl } = await import('./proCheckout.ts');
  const capability = JSON.parse(readFileSync(new URL('../../src-tauri/capabilities/desktop.json', import.meta.url), 'utf8')) as { permissions: (string | { identifier: string; allow: { url: string }[] })[] };
  const allowed = capability.permissions.flatMap((p) => (typeof p === 'object' && p.identifier === 'opener:allow-open-url' ? p.allow.map((a) => a.url) : []));
  // The opener's patterns end in one `*` wildcard here: match the fixed part before it.
  const opens = (url: string) => allowed.some((pattern) => (pattern.endsWith('*') ? url.startsWith(pattern.slice(0, -1)) : url === pattern));
  for (const portal of ['https://customer-portal.paddle.com/cpl_01abc/subscriptions/sub_01abc/cancel', 'https://sandbox-customer-portal.paddle.com/cpl_01abc']) {
    assert.equal(isPaddlePortalUrl(portal), true);
    assert.equal(opens(portal), true, `${portal} must be on the desktop opener allow-list, or Manage and Cancel cannot open it`);
  }
  assert.equal(opens(`https://inflight.studio/pro-checkout?_ptxn=${ID}`), true);
});
