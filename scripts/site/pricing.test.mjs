import test from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK, currencyFor, loadPricing, priceText, readPricing } from '../../site/assets/pricing.mjs';
import { DEFAULT_PRICING, parsePricingMatrix, publicPricing } from '../../src/core/pricingMatrix.ts';

test('the site fallback is exactly the matrix default, so no price is guessed', () => {
  assert.deepEqual(FALLBACK.currencies, publicPricing(DEFAULT_PRICING).currencies);
});

test('the site shows the served matrix in the visitor\'s currency, or GBP', async () => {
  const served = publicPricing(parsePricingMatrix({ ...DEFAULT_PRICING, rates: { date: '2026-11-25', perGbp: { EUR: 1.17 } }, currencies: { EUR: { rounding: 'charm', overrides: {} } } }));
  const pricing = await loadPricing(async () => new Response(JSON.stringify(served)));
  assert.equal(currencyFor(pricing, 'fr'), 'EUR');
  assert.equal(currencyFor(pricing, 'US'), 'GBP');
  assert.equal(priceText(pricing, 'EUR', 'pro.monthly'), '€3.99');
  assert.equal(priceText(pricing, 'EUR', 'pro.annual'), '€35');
  assert.equal(priceText(pricing, 'GBP', 'pro.annual'), '£29.99');
  assert.equal(await loadPricing(async () => { throw new Error('offline'); }), FALLBACK);
  assert.equal(readPricing({ version: 1, currencies: { EUR: { digits: 2, 'pro.monthly': 1, 'pro.annual': 1 } } }), null, 'GBP is required');
});
