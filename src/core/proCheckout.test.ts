import assert from 'node:assert/strict';
import test from 'node:test';
import { checkoutErrorText, COUNTRY_CODES, isSumUpCheckoutUrl, keepPolling, parseCheckoutPoll, parseCheckoutStart, priceText, suggestedCountry, CHECKOUT_POLL_LIMIT_MS, CHECKOUT_POLL_MS } from './proCheckout.ts';

test('a started checkout gives the id, SumUp page and price', () => {
  assert.deepEqual(parseCheckoutStart(201, { checkoutId: 'chk-1', url: 'https://checkout.sumup.com/pay/c-1', totalPence: 4900, currency: 'GBP' }),
    { ok: true, checkoutId: 'chk-1', url: 'https://checkout.sumup.com/pay/c-1', totalPence: 4900, currency: 'GBP' });
  assert.deepEqual(parseCheckoutStart(201, { checkoutId: 'chk-1', url: 'https://checkout.sumup.com/pay/c-1' }),
    { ok: true, checkoutId: 'chk-1', url: 'https://checkout.sumup.com/pay/c-1', totalPence: null, currency: null });
});

test('a page that is not SumUp over HTTPS is never opened', () => {
  for (const url of ['http://checkout.sumup.com/x', 'https://sumup.com.evil.example/x', 'https://evil.example/?sumup.com', 'https://user:pw@checkout.sumup.com/', 'javascript:alert(1)', 42]) {
    assert.equal(isSumUpCheckoutUrl(url), false, String(url));
    assert.equal(parseCheckoutStart(201, { checkoutId: 'chk-1', url }).ok, false);
  }
  assert.equal(parseCheckoutStart(201, { checkoutId: '../x', url: 'https://checkout.sumup.com/a' }).ok, false);
});

test('each refusal from the server is explained calmly, and says nothing was charged where that matters', () => {
  const refused = (code: string, status = 409) => parseCheckoutStart(status, { error: { code, message: 'server words' } });
  assert.deepEqual(refused('CHECKOUT_DISABLED', 503), { ok: false, code: 'CHECKOUT_DISABLED', message: checkoutErrorText('CHECKOUT_DISABLED') });
  assert.match(refused('CHECKOUT_DISABLED', 503).ok ? '' : (refused('CHECKOUT_DISABLED', 503) as { message: string }).message, /not open yet/);
  assert.match((refused('COUNTRY_UNAVAILABLE') as { message: string }).message, /not on sale in your country/);
  assert.match((refused('LOCATION_UNCONFIRMED') as { message: string }).message, /VPN/);
  assert.match((refused('LOCATION_UNCONFIRMED') as { message: string }).message, /Nothing was charged/);
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

test('the suggested country comes from the language setting, and the list is every ISO country once', () => {
  assert.equal(suggestedCountry(['en-GB']), 'GB');
  assert.equal(suggestedCountry(['fr-CA', 'en-GB']), 'CA');
  assert.equal(suggestedCountry(['not a locale']), null);
  assert.equal(COUNTRY_CODES.length, 249);
  assert.equal(new Set(COUNTRY_CODES).size, 249);
  assert.ok(COUNTRY_CODES.every((c) => /^[A-Z]{2}$/.test(c)));
  assert.equal(priceText(4900, 'GBP', 'en-GB'), '£49.00');
  assert.equal(priceText(null, 'GBP'), null);
});

test('Paddle: only our own website\'s /checkout page with a Paddle transaction is opened', async () => {
  const { isPaddleCheckoutUrl } = await import('./proCheckout.ts');
  const txn = 'txn_' + 'a1'.repeat(13);
  assert.equal(isPaddleCheckoutUrl('https://inflight.studio/checkout?_ptxn=' + txn), true);
  assert.equal(isPaddleCheckoutUrl('https://kestrel-hosting-kestrel.web.app/checkout?_ptxn=' + txn), true);
  for (const url of [
    'http://inflight.studio/checkout?_ptxn=' + txn, 'https://evil.example/checkout?_ptxn=' + txn,
    'https://inflight.studio.evil.example/checkout?_ptxn=' + txn, 'https://inflight.studio/other?_ptxn=' + txn,
    'https://inflight.studio/checkout', 'https://inflight.studio/checkout?_ptxn=txn_x', 'https://a:b@inflight.studio/checkout?_ptxn=' + txn,
  ]) assert.equal(isPaddleCheckoutUrl(url), false, url);
  const started = parseCheckoutStart(201, { checkoutId: txn, url: 'https://inflight.studio/checkout?_ptxn=' + txn, totalPence: 2900, currency: 'GBP' });
  assert.equal(started.ok, true);
});
