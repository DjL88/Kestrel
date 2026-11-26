import test from 'node:test';
import assert from 'node:assert/strict';
import { pricingSource, PRICING_REFRESH_MS } from './pricing.ts';

const served = { version: 1, base: 'GBP', updatedAt: '2026-11-26T10:00:00.000Z', currencies: { GBP: { digits: 2, 'pro.monthly': 299, 'pro.annual': 2999 }, EUR: { digits: 2, 'pro.monthly': 349, 'pro.annual': 3400 } }, regions: { FR: 'EUR' } };

test('the app shows the served matrix, keeps it offline, and falls back to the starting prices', async () => {
  const items = new Map<string, string>();
  const storage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => { items.set(k, v); } };
  let calls = 0;
  let clock = 1_000;
  let online = true;
  const source = pricingSource({ baseUrl: 'https://cp.example', storage, now: () => clock, fetch: (async () => {
    calls++;
    if (!online) throw new Error('offline');
    return new Response(JSON.stringify(served), { status: 200 });
  }) as typeof fetch });

  assert.deepEqual(Object.keys(source.current().currencies), ['GBP'], 'compiled starting prices before anything is read');
  assert.equal((await source.refresh()).currencies.EUR['pro.monthly'], 349);
  await source.refresh();
  assert.equal(calls, 1, 'not fetched again until due');
  clock += PRICING_REFRESH_MS + 1;
  online = false;
  assert.equal((await source.refresh()).currencies.EUR['pro.annual'], 3400, 'offline keeps the last copy');
  assert.equal(source.current().regions.FR, 'EUR');

  const none = pricingSource({ baseUrl: null, storage: { getItem: () => null, setItem: () => {} }, now: () => 0, fetch: (async () => { throw new Error('must not fetch'); }) as typeof fetch });
  assert.equal((await none.refresh()).currencies.GBP['pro.annual'], 2999);
});
