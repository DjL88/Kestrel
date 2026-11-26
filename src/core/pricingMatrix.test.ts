import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PRICING, computePrices, currencyForRegion, formatPrice, paddleDifferences, paddlePriceUpdate, parsePricingMatrix,
  publicPricing, readPublicPricing, tidyPrice, type PricingMatrix,
} from './pricingMatrix.ts';

const withRates = (): PricingMatrix => parsePricingMatrix({
  ...DEFAULT_PRICING,
  rates: { date: '2026-11-25', perGbp: { EUR: 1.17, USD: 1.27, SEK: 13.5, JPY: 190 } },
  currencies: { EUR: { rounding: 'charm', overrides: {} }, USD: { rounding: 'charm', overrides: { 'pro.annual': 2900 } }, SEK: { rounding: 'charm', overrides: {} }, JPY: { rounding: 'charm', overrides: {} }, CAD: { rounding: 'charm', overrides: {} } },
});

test('tidy prices land on the price points people expect', () => {
  assert.equal(tidyPrice(349.8, 2, 'charm'), 399);
  assert.equal(tidyPrice(320, 2, 'charm'), 299);
  assert.equal(tidyPrice(3508.8, 2, 'charm'), 3500);
  assert.equal(tidyPrice(40486.5, 2, 'charm'), 40900);
  assert.equal(tidyPrice(568, 0, 'charm'), 569);
  assert.equal(tidyPrice(5200, 0, 'charm'), 5190);
  assert.equal(tidyPrice(3, 2, 'charm'), 99, 'never below one step');
  assert.equal(tidyPrice(349.8, 2, 'whole'), 300);
  assert.equal(tidyPrice(349.8, 2, 'exact'), 350);
});

test('the default matrix offers GBP only until rates are refreshed, and never guesses', () => {
  const { all, offered } = computePrices(DEFAULT_PRICING);
  assert.deepEqual(offered.map((row) => row.currency), ['GBP']);
  assert.ok(all.length > 1);
  assert.deepEqual(publicPricing(DEFAULT_PRICING).currencies.GBP, { digits: 2, 'pro.monthly': 299, 'pro.annual': 2999 });
});

test('conversions use the stored rate, overrides always win, and a currency without a rate is not offered', () => {
  const { offered } = computePrices(withRates());
  const by = Object.fromEntries(offered.map((row) => [row.currency, row]));
  assert.deepEqual(Object.keys(by), ['GBP', 'EUR', 'JPY', 'SEK', 'USD']);
  assert.equal(by.EUR.prices['pro.monthly']!.minor, 399);
  assert.equal(by.USD.prices['pro.annual']!.minor, 2900);
  assert.equal(by.USD.prices['pro.annual']!.source, 'override');
  assert.equal(by.JPY.digits, 0);
});

test('a bad matrix is refused in plain words', () => {
  assert.throws(() => parsePricingMatrix({ ...DEFAULT_PRICING, base: { 'pro.monthly': 0, 'pro.annual': 2999 } }), /above zero/);
  assert.throws(() => parsePricingMatrix({ ...DEFAULT_PRICING, currencies: { ISK: { rounding: 'charm', overrides: {} } } }), /Paddle cannot charge in ISK/);
  assert.throws(() => parsePricingMatrix({ ...DEFAULT_PRICING, currencies: { EUR: { rounding: 'charm', overrides: { 'pro.monthly': 2.5 } } } }), /minor units/);
  assert.throws(() => parsePricingMatrix({ ...DEFAULT_PRICING, rates: { date: 'today', perGbp: {} } }), /yyyy-mm-dd/);
});

test('the public table maps countries to currencies and the reader rejects junk', () => {
  const served = publicPricing(withRates());
  assert.equal(served.regions.DE, 'EUR');
  assert.equal(served.regions.IS, 'EUR');
  assert.equal(served.regions.CA, undefined, 'CAD has no rate yet');
  const read = readPublicPricing(JSON.parse(JSON.stringify(served)))!;
  assert.equal(currencyForRegion(read, 'de'), 'EUR');
  assert.equal(currencyForRegion(read, 'CA'), 'GBP');
  assert.equal(currencyForRegion(read, null), 'GBP');
  assert.equal(readPublicPricing({ version: 2 }), null);
  assert.equal(readPublicPricing({ version: 1, currencies: { EUR: {} } }), null);
});

test('formatting shows whole amounts without decimals', () => {
  assert.equal(formatPrice(299, 'GBP', 2), '£2.99');
  assert.equal(formatPrice(2900, 'USD', 2), '$29');
  assert.equal(formatPrice(569, 'JPY', 0, 'en-GB'), 'JP¥569');
});

test('the Paddle body and the Paddle check agree with the matrix', () => {
  const matrix = withRates();
  const body = paddlePriceUpdate(matrix, 'pro.monthly');
  assert.deepEqual(body.unit_price, { amount: '299', currency_code: 'GBP' });
  const eur = body.unit_price_overrides.find((o) => o.unit_price.currency_code === 'EUR')!;
  assert.equal(eur.unit_price.amount, '399');
  assert.ok(eur.country_codes.includes('FR'));
  assert.deepEqual(paddleDifferences(matrix, 'pro.monthly', { id: 'pri_x', ...body }), []);

  const stale = { id: 'pri_x', unit_price: { amount: '299', currency_code: 'GBP' }, unit_price_overrides: [
    { country_codes: ['US'], unit_price: { amount: '349', currency_code: 'USD' } },
    { country_codes: ['DE'], unit_price: { amount: '399', currency_code: 'EUR' } },
    { country_codes: ['CA'], unit_price: { amount: '499', currency_code: 'CAD' } },
  ] };
  const found = paddleDifferences(matrix, 'pro.monthly', stale);
  assert.deepEqual(found.map((d) => d.currency), ['CAD', 'EUR', 'JPY', 'SEK', 'USD']);
  assert.deepEqual(found.find((d) => d.currency === 'EUR'), { item: 'pro.monthly', currency: 'EUR', matrix: 399, paddle: null }, 'only some euro countries overridden');
  assert.deepEqual(found.find((d) => d.currency === 'CAD'), { item: 'pro.monthly', currency: 'CAD', matrix: null, paddle: 499 });
});
