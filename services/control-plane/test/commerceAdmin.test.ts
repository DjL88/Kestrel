import test from 'node:test';
import assert from 'node:assert/strict';
import type { TaxSettings } from '../src/commerce/tax.ts';
import { ukTurnoverMetrics } from '../src/commerce/turnover.ts';
import { startHarness } from './helpers.ts';

test('only admins can view or activate VAT and export OSS summaries', async () => {
  let settings: TaxSettings = { ukVatRegistered: false, b2cPricing: 'exclusive', localTaxes: {} };
  const h = await startHarness(null, {
    async getTaxSettings() { return settings; },
    async updateTaxSettings(next) { settings = next; },
    async recordTurnover(asOf) {
      return { ...ukTurnoverMetrics([{ country: 'GB', supplyDate: '2026-11-01', netPence: 7_500_000 }], asOf), updatedAt: asOf };
    },
    async latestPriceReview() { return { month: '2026-11', proposedGbpPence: 2900 }; },
    async ossQuarter() { return [{ country: 'DE', rateBasisPoints: 1900, netPence: 2900, taxPence: 551 }]; },
  });
  try {
    assert.equal((await h.call('GET', '/v1/admin/tax')).status, 401);
    assert.equal((await h.call('GET', '/v1/admin/tax', { token: h.user.token })).status, 403);
    assert.equal((await h.call('GET', '/v1/admin/pricing/review', { token: h.user.token })).status, 403);
    const token = h.adminToken;
    const pricing = await h.call('GET', '/v1/admin/pricing/review', { token });
    assert.equal(pricing.status, 200);
    assert.equal(pricing.body.review.month, '2026-11');
    const summary = await h.call('GET', '/v1/admin/tax', { token });
    assert.equal(summary.body.turnover.state, 'warning');
    assert.equal(summary.body.thresholdPence, 9_000_000);
    const enable = { ...settings, ukVatRegistered: true };
    assert.equal((await h.call('POST', '/v1/admin/tax/settings', { token, body: enable })).status, 400);
    assert.equal(settings.ukVatRegistered, false);
    assert.equal((await h.call('POST', '/v1/admin/tax/settings', { token, body: { ...enable, ukVatNumber: 'GB123456789' } })).status, 200);
    assert.equal(settings.ukVatRegistered, true);
    assert.equal((await h.call('GET', '/v1/admin/tax/oss?year=2026&quarter=5', { token })).status, 400);
    const report = await h.call('GET', '/v1/admin/tax/oss?year=2026&quarter=4', { token });
    assert.equal(report.body.rows[0].taxPence, 551);
  } finally { await h.close(); }
});
