import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_PRICING_FAILURE_TTL_MS, LOCAL_PRICING_TTL_MS, localPricing, readPricePreview, visitorIp } from '../src/localPricing.ts';
import { paddleApi } from '../src/commerce/paddle.ts';
import { startHarness } from './helpers.ts';

const IDS = { monthly: 'pri_monthly0000001', annual: 'pri_annual00000001' };
const preview = (currency: string, monthly: string, annual: string) => ({
  currency_code: currency, address: { country_code: 'FR' },
  details: { line_items: [
    { price: { id: IDS.monthly }, formatted_totals: { subtotal: monthly, total: monthly } },
    { price: { id: IDS.annual }, formatted_totals: { subtotal: annual, total: annual } },
  ] },
});
const countries: Record<string, string> = { '81.2.69.142': 'GB', '2.16.0.1': 'FR', '2.16.0.2': 'FR', '8.8.8.8': 'US' };
const lookup = async () => (ip: string) => countries[ip] ?? null;

test('the visitor is the first public address Firebase forwards; private hops and junk are skipped', () => {
  assert.equal(visitorIp({ 'x-forwarded-for': '2.16.0.1, 35.191.0.1' }), '2.16.0.1');
  assert.equal(visitorIp({ 'x-forwarded-for': '10.0.0.4, 192.168.1.2, 2.16.0.1' }), '2.16.0.1');
  assert.equal(visitorIp({ 'x-forwarded-for': 'not-an-ip, 8.8.8.8' }), '8.8.8.8');
  assert.equal(visitorIp({ 'x-forwarded-for': '2001:db8::1' }), '2001:db8::1');
  assert.equal(visitorIp({}, '127.0.0.1'), null, 'a local socket is not a visitor');
  assert.equal(visitorIp({}, '8.8.8.8'), '8.8.8.8');
});

test("Paddle's preview gives the currency and both formatted totals, or nothing", () => {
  assert.deepEqual(readPricePreview(preview('EUR', '€3.99', '€35.00'), IDS), { currency: 'EUR', monthly: '€3.99', annual: '€35.00' });
  assert.equal(readPricePreview({ currency_code: 'EUR', details: { line_items: [] } }, IDS), null);
  assert.equal(readPricePreview({ currency_code: 'euro' }, IDS), null);
  assert.equal(readPricePreview(null, IDS), null);
});

test('cached by country for an hour: two French visitors make one Paddle call, and the address is never passed on', async () => {
  let now = 0;
  const asked: string[] = [];
  const prices = localPricing({ lookup, now: () => now, preview: async (country) => { asked.push(country); return readPricePreview(preview('EUR', '€3.99', '€35.00'), IDS); } });
  assert.deepEqual(await prices({ headers: { 'x-forwarded-for': '2.16.0.1' }, ip: '35.191.0.1' }), { currency: 'EUR', monthly: '€3.99', annual: '€35.00' });
  assert.equal((await prices({ headers: { 'x-forwarded-for': '2.16.0.2' }, ip: '35.191.0.1' }))?.currency, 'EUR');
  assert.deepEqual(asked, ['FR'], 'only the country goes to Paddle, once');
  now += LOCAL_PRICING_TTL_MS + 1;
  await prices({ headers: { 'x-forwarded-for': '2.16.0.1' }, ip: '35.191.0.1' });
  assert.deepEqual(asked, ['FR', 'FR'], 'asked again after an hour');
});

test('unknown country, a failed lookup or Paddle down all mean "use the site\'s own prices", and a failure is not retried at once', async () => {
  let now = 0, calls = 0;
  const down = localPricing({ lookup, now: () => now, preview: async () => { calls++; throw new Error('Paddle request failed with 503.'); } });
  assert.equal(await down({ headers: { 'x-forwarded-for': '8.8.8.8' }, ip: '' }), null);
  assert.equal(await down({ headers: { 'x-forwarded-for': '8.8.8.8' }, ip: '' }), null);
  assert.equal(calls, 1, 'a failure is remembered for a few minutes');
  now += LOCAL_PRICING_FAILURE_TTL_MS + 1;
  await down({ headers: { 'x-forwarded-for': '8.8.8.8' }, ip: '' });
  assert.equal(calls, 2);
  assert.equal(await down({ headers: { 'x-forwarded-for': '203.0.113.9' }, ip: '' }), null, 'no country: nothing asked');
  const broken = localPricing({ lookup: async () => { throw new Error('database missing'); }, now: () => 0, preview: async () => { throw new Error('not reached'); } });
  assert.equal(await broken({ headers: { 'x-forwarded-for': '2.16.0.1' }, ip: '' }), null);
});

test('the Paddle call sends only the country and the two prices', async () => {
  let sent: { url: string; body: unknown } | null = null;
  const api = paddleApi({ apiKey: 'k', environment: 'sandbox' }, (async (url: string, init?: RequestInit) => {
    sent = { url, body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ data: preview('EUR', '€3.99', '€35.00') }), { status: 200 });
  }) as typeof fetch);
  const data = await api.previewPrices([IDS.monthly, IDS.annual], 'FR');
  assert.equal(sent!.url, 'https://sandbox-api.paddle.com/pricing-preview');
  assert.deepEqual(sent!.body, { items: [{ price_id: IDS.monthly, quantity: 1 }, { price_id: IDS.annual, quantity: 1 }], address: { country_code: 'FR' } });
  assert.equal(JSON.stringify(sent!.body).includes('2.16.0.1'), false);
  assert.equal(readPricePreview(data, IDS)?.annual, '€35.00');
  await assert.rejects(api.previewPrices([IDS.monthly], 'france'), /Invalid/);
});

test('GET /v1/pricing/local answers the local prices, privately cached, or 503 so the site falls back', async () => {
  const off = await startHarness();
  try { assert.equal((await off.call('GET', '/v1/pricing/local')).status, 503); } finally { await off.close(); }
  const h = await startHarness(undefined, undefined, { pricingDeps: { localPrices: async (req) => (req.headers['x-forwarded-for'] === '2.16.0.1' ? { currency: 'EUR', monthly: '€3.99', annual: '€35.00' } : null) } });
  try {
    const r = await h.call('GET', '/v1/pricing/local', { headers: { 'x-forwarded-for': '2.16.0.1' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { currency: 'EUR', monthly: '€3.99', annual: '€35.00' });
    assert.match(r.headers.get('cache-control') ?? '', /^private/);
    assert.equal((await h.call('GET', '/v1/pricing/local', { headers: { 'x-forwarded-for': '8.8.8.8' } })).status, 503);
  } finally { await h.close(); }
});
