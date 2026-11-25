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
