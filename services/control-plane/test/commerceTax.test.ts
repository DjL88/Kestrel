import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteProTax, type LocationEvidence, type TaxSettings } from '../src/commerce/tax.ts';
import { ukTurnoverMetrics } from '../src/commerce/turnover.ts';

const date = '2026-11-20T12:00:00.000Z';
const defaults: TaxSettings = { ukVatRegistered: false, b2cPricing: 'exclusive', localTaxes: {} };
const location = (country: string) => ({
  country, evidence: [
    { source: 'billing-address', country, observedAt: date },
    { source: 'ip-geolocation', country, observedAt: date },
  ] satisfies LocationEvidence[],
});

test('UK before activation issues a £29 quote without a VAT number', () => {
  const quote = quoteProTax(location('GB'), defaults);
  assert.deepEqual([quote.treatment, quote.taxPence, quote.totalPence, quote.vatNumber], ['uk-unregistered', 0, 2900, null]);
});

test('UK activation requires a number and charges 20% for domestic businesses too', () => {
  const settings = { ...defaults, ukVatRegistered: true };
  assert.throws(() => quoteProTax(location('GB'), settings), /VAT number/);
  const quote = quoteProTax({
    country: 'GB', evidence: [],
    verification: { country: 'GB', vatId: '123456789', provider: 'HMRC', checkedAt: date, reference: 'ref' },
  }, { ...settings, ukVatNumber: '123456789' });
  assert.deepEqual([quote.customerType, quote.taxPence, quote.totalPence], ['B2B', 580, 3480]);
});

test('Germany and France apply OSS rates and support inclusive price display', () => {
  const de = quoteProTax(location('DE'), defaults);
  assert.deepEqual([de.treatment, de.taxPence, de.totalPence], ['eu-oss', 551, 3451]);
  assert.equal(quoteProTax(location('FR'), defaults).totalPence, 3480);
  const inclusive = quoteProTax(location('FR'), { ...defaults, b2cPricing: 'inclusive' });
  assert.deepEqual([inclusive.netPence, inclusive.taxPence, inclusive.totalPence], [2417, 483, 2900]);
});

test('matching VIES status enables reverse charge and preserves verification', () => {
  const verification = { country: 'DE', vatId: 'DE123456789', provider: 'VIES', checkedAt: date, reference: 'ref' } as const;
  const quote = quoteProTax({ ...location('DE'), verification }, defaults);
  assert.deepEqual([quote.customerType, quote.taxPence, quote.invoiceNotice, quote.verification], ['B2B', 0, 'Reverse charge', verification]);
  assert.equal(quoteProTax({ ...location('FR'), verification }, defaults).customerType, 'B2C');
});

test('US taxes are off by default and configurable by state', () => {
  assert.equal(quoteProTax(location('US'), defaults).totalPence, 2900);
  const quote = quoteProTax({ ...location('US'), region: 'NY' }, {
    ...defaults, localTaxes: { 'US-NY': { enabled: true, rateBasisPoints: 800 } },
  });
  assert.deepEqual([quote.jurisdiction, quote.totalPence], ['US-NY', 3132]);
});

test('missing or contradictory consumer location evidence fails closed', () => {
  assert.throws(() => quoteProTax({ country: 'DE', evidence: [] }, defaults), /location evidence/);
  assert.throws(() => quoteProTax({ country: 'DE', evidence: location('FR').evidence }, defaults), /location evidence/);
});

test('rolling turnover excludes overseas and older revenue and distinguishes the two liability dates', () => {
  const entries = [
    { country: 'GB', supplyDate: '2025-11-30', netPence: 7_000_000 },
    { country: 'FR', supplyDate: '2026-11-20', netPence: 7_000_000 },
    { country: 'GB', supplyDate: '2026-11-20', netPence: 9_000_001 },
  ];
  const rolling = ukTurnoverMetrics(entries, '2026-11-30');
  assert.equal(rolling.rollingPence, 9_000_001);
  assert.deepEqual(rolling.backward, { notificationDue: '2026-12-30', effectiveDate: '2027-01-01' });
  const forward = ukTurnoverMetrics([], '2026-11-20', { recognisedOn: '2026-11-20', next30DaysPence: 9_000_001 });
  assert.deepEqual(forward.forward, { notificationDue: '2026-12-20', effectiveDate: '2026-11-20' });
});

test('local pricing rounds before tax and keeps the GBP bases unchanged', async () => {
  const { quoteLocalPrice } = await import('../src/commerce/localPrice.ts');
  const now = Date.parse(date);
  const currencies = new Set(['GBP', 'EUR', 'USD', 'JPY']);
  const rate = { currency: 'EUR', partsPerMillion: 1_200_000, retrievedAt: date, source: 'test rate' };
  const eu = quoteLocalPrice('pro', 'EUR', rate, currencies, location('DE'), defaults, now);
  assert.deepEqual([eu.roundedBaseMinor, eu.taxMinor, eu.totalMinor], [3500, 665, 4165]);
  const monthly = quoteLocalPrice('geminiMonthly', 'EUR', rate, currencies, location('DE'), defaults, now);
  assert.deepEqual([monthly.roundedBaseMinor, monthly.taxMinor, monthly.totalMinor], [125, 24, 149]);
  assert.equal(quoteLocalPrice('geminiMonthly', 'GBP', undefined, currencies, location('GB'), defaults, now).totalMinor, 99);
  const yen = quoteLocalPrice('pro', 'JPY', { ...rate, currency: 'JPY', partsPerMillion: 200_000_000 }, currencies, location('JP'), defaults, now);
  assert.deepEqual([yen.minorUnitDigits, yen.totalMinor], [0, 5800]);
  assert.throws(() => quoteLocalPrice('pro', 'EUR', rate, currencies, location('DE'), defaults, now + 8 * 86_400_000), /current exchange rate/);
  assert.throws(() => quoteLocalPrice('pro', 'CAD', rate, currencies, location('CA'), defaults, now), /unavailable/);
});

test('April CPI review proposes a rounded GBP base and local FX review uses that proposed base', async () => {
  const { quoteLocalPrice, reviewGbpProPrice } = await import('../src/commerce/localPrice.ts');
  const review = reviewGbpProPrice(2900, 125, 137.5);
  assert.equal(review.proposedPence, 3200);
  assert.throws(() => reviewGbpProPrice(2900, 0, 137.5), /CPI/);
  const currencies = new Set(['GBP', 'AUD']);
  const now = Date.parse(date);
  const rate = { currency: 'AUD', partsPerMillion: 2_000_000, retrievedAt: date, source: 'test rate' };
  const australia = quoteLocalPrice('pro', 'AUD', rate, currencies, location('AU'), defaults, now, review.proposedPence);
  assert.equal(australia.totalMinor, 6500);
  const uk = quoteLocalPrice('pro', 'GBP', undefined, currencies, location('GB'), defaults, now, review.proposedPence);
  assert.equal(uk.totalMinor, 3200);
});

test('previous-version and event offers apply before VAT, without adding the discounts together', async () => {
  const { resolveProOffer } = await import('../src/commerce/offers.ts');
  const { quoteLocalPrice } = await import('../src/commerce/localPrice.ts');
  const previous = { version: '2026', gbpBasePence: 2900, discountBasisPoints: 5000 };
  const current = { version: '2027', gbpBasePence: 3200 };
  const coupon = {
    code: 'BLACK-FRIDAY', versions: ['2026', '2027'], discountBasisPoints: 2000,
    startsAt: '2026-11-20T00:00:00Z', endsAt: '2026-11-30T00:00:00Z',
  };
  const now = Date.parse(date);
  const currencies = new Set(['GBP']);
  const older = quoteLocalPrice('pro', 'GBP', undefined, currencies, location('GB'), defaults, now, 3200,
    resolveProOffer(previous, [coupon], 'black-friday', now));
  assert.deepEqual([older.roundedBaseMinor, older.discountMinor, older.totalMinor], [2900, 1450, 1450]);
  const blackFriday = quoteLocalPrice('pro', 'GBP', undefined, currencies, location('GB'),
    { ...defaults, ukVatRegistered: true, ukVatNumber: 'GB123456789' }, now, 3200,
    resolveProOffer(current, [coupon], 'BLACK-FRIDAY', now));
  assert.deepEqual([blackFriday.netMinor, blackFriday.taxMinor, blackFriday.totalMinor], [2560, 512, 3072]);
  assert.throws(() => resolveProOffer(current, [coupon], coupon.code, Date.parse(coupon.endsAt)), /unavailable/);
  assert.throws(() => resolveProOffer({ ...current, version: '2028' }, [coupon], coupon.code, now), /unavailable/);
});
