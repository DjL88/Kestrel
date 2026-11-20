import assert from 'node:assert/strict';
import test from 'node:test';
import { startHarness } from './helpers.ts';
import { proposePrices } from '../src/commerce/priceReview.ts';

const settings = { gbpProBasePence: 2900, effectiveDate: '2026-04-20', currencies: ['GBP', 'AUD', 'USD'] };
const fx = (date: string) => `<Cube><Cube time='${date}'><Cube currency='GBP' rate='0.8'/><Cube currency='AUD' rate='1.6'/></Cube></Cube>`;

test('monthly review keeps GBP unchanged and rounds foreign currency proposals', () => {
  const review = proposePrices(new Date('2026-11-20T09:00:00Z'), settings, fx('2026-11-19'));
  assert.equal(review.inflation, null);
  assert.equal(review.approvedBasePence, 2900);
  assert.equal(review.proposedGbpPence, 2900);
  assert.deepEqual(review.prices, [
    { currency: 'GBP', ratePerGbp: 1, unroundedMajor: 29, proposedMajor: 29, status: 'for-review' },
    { currency: 'AUD', ratePerGbp: 2, unroundedMajor: 58, proposedMajor: 60, status: 'for-review' },
    { currency: 'USD', status: 'missing-rate' },
  ]);
});

test('April applies cumulative CPI first, then converts and rounds', () => {
  const review = proposePrices(new Date('2027-04-20T08:00:00Z'), settings, fx('2027-04-19'), { months: [
    { date: '2027 MAR', value: '110' },
    { date: '2026 APR', value: '100' },
    { date: '2027 MAY', value: '300' },
    { date: '2027 JAN', value: '108' },
  ] });
  assert.equal(review.approvedBasePence, 2900);
  assert.equal(review.proposedGbpPence, 3200);
  assert.equal(review.inflation?.latest.date, '2027 MAR');
  assert.deepEqual(review.prices[1], { currency: 'AUD', ratePerGbp: 2, unroundedMajor: 64, proposedMajor: 65, status: 'for-review' });
});

test('missing or stale data cannot be used as a price proposal', () => {
  const now = new Date('2027-04-20T08:00:00Z');
  assert.throws(() => proposePrices(now, settings, fx('2027-04-01')), /review window/);
  assert.throws(() => proposePrices(now, settings, fx('2027-04-19'), { months: [] }), /approved GBP price month/);
  assert.throws(() => proposePrices(now, { ...settings, effectiveDate: '2026-02-30' }, fx('2027-04-19')), /valid effective date/);
});

test('price proposal is visible only to an admin and cannot be cached', async () => {
  const review = proposePrices(new Date('2026-11-20T09:00:00Z'), settings, fx('2026-11-19'));
  const harness = await startHarness(null, undefined, { pricing: { async latestPriceReview() { return review; } } });
  try {
    const path = '/v1/admin/pricing/review';
    assert.equal((await harness.call('GET', path)).status, 401);
    assert.equal((await harness.call('GET', path, { token: harness.user.token })).status, 403);
    const result = await harness.call('GET', path, { token: harness.adminToken });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(result.body, { review });
  } finally {
    await harness.close();
  }
});
