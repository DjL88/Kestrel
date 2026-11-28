import test from 'node:test';
import assert from 'node:assert/strict';
import { startHarness } from './helpers.ts';
import { DEFAULT_PRICING, type PaddlePriceView } from '../../../src/core/pricingMatrix.ts';

test('the website and app read every price from the one matrix that Admin edits, and Paddle is kept in step', async () => {
  let saved: unknown = null;
  const paddle = new Map<string, PaddlePriceView>([
    ['pri_monthly0000001', { id: 'pri_monthly0000001', unit_price: { amount: '299', currency_code: 'GBP' }, unit_price_overrides: [] }],
    ['pri_annual00000001', { id: 'pri_annual00000001', unit_price: { amount: '2999', currency_code: 'GBP' }, unit_price_overrides: [] }],
  ]);
  const h = await startHarness(undefined, undefined, { pricingDeps: {
    priceMatrix: { get: async () => saved, save: async (m) => { saved = m; } },
    paddlePrices: {
      priceIds: { monthly: 'pri_monthly0000001', annual: 'pri_annual00000001' },
      get: async (id) => paddle.get(id)!,
      update: async (id, body) => { paddle.set(id, { id, ...body }); return paddle.get(id); },
    },
    ecbRates: async () => ({ date: '2026-11-25', perGbp: { EUR: 1.17, USD: 1.27 } }),
  } });
  try {
    // Before any save: GBP only, nothing guessed.
    const first = await h.call('GET', '/v1/pricing');
    assert.equal(first.status, 200);
    assert.deepEqual(Object.keys(first.body.currencies), ['GBP']);
    assert.equal(first.body.currencies.GBP['pro.annual'], 2999);

    assert.equal((await h.call('GET', '/v1/admin/pricing', { token: h.user.token })).status, 403, 'admins only');
    assert.equal((await h.call('POST', '/v1/admin/pricing', { token: h.user.token, body: DEFAULT_PRICING })).status, 403);

    const before = await h.call('GET', '/v1/admin/pricing', { token: h.adminToken });
    assert.equal(before.body.paddle.inStep, true, 'Paddle annual and the matrix are both £29.99');

    const { body: { rates } } = await h.call('POST', '/v1/admin/pricing/rates', { token: h.adminToken, body: {} });
    const edited = { ...DEFAULT_PRICING, rates, currencies: { EUR: { rounding: 'charm', overrides: {} }, USD: { rounding: 'charm', overrides: { 'pro.annual': 2900 } } } };
    const refused = await h.call('POST', '/v1/admin/pricing', { token: h.adminToken, body: { ...edited, currencies: { ISK: { rounding: 'charm', overrides: {} } } } });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error.message, /Paddle cannot charge in ISK/);

    const preview = await h.call('POST', '/v1/admin/pricing/preview', { token: h.adminToken, body: edited });
    assert.equal(preview.status, 200);
    assert.equal(saved, null, 'a preview saves nothing');

    const save = await h.call('POST', '/v1/admin/pricing', { token: h.adminToken, body: edited });
    assert.equal(save.status, 200);
    assert.equal(save.body.paddle.inStep, false);
    const served = await h.call('GET', '/v1/pricing');
    assert.deepEqual(served.body.currencies.EUR, { digits: 2, 'pro.monthly': 399, 'pro.annual': 3500, 'plus.monthly': 1199, 'plus.annual': 11900 });
    assert.equal(served.body.currencies.USD['pro.annual'], 2900);
    assert.equal(served.body.regions.FR, 'EUR');

    const pushed = await h.call('POST', '/v1/admin/pricing/paddle', { token: h.adminToken, body: {} });
    assert.equal(pushed.status, 200);
    assert.equal(pushed.body.paddle.inStep, true);
    assert.equal(paddle.get('pri_annual00000001')!.unit_price.amount, '2999');
  } finally { await h.close(); }
});
