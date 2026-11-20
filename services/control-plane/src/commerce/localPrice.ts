import type { resolveProOffer } from './offers.ts';
import { calculateTaxAmounts, PRO_BASE_PENCE, quoteProTax } from './tax.ts';

const pricesInGbpPence = { pro: PRO_BASE_PENCE, geminiMonthly: 99 } as const;
/** April uses the cumulative index change since the last approved price. */
export function reviewGbpProPrice(basePence: number, baselineCpi: number, latestCpi: number) {
  if (!Number.isSafeInteger(basePence) || basePence <= 0
    || !Number.isFinite(baselineCpi) || baselineCpi <= 0
    || !Number.isFinite(latestCpi) || latestCpi <= 0) {
    throw new Error('A positive base price and two published UK CPI index values are required.');
  }
  const multiplier = latestCpi / baselineCpi;
  const proposedPence = Math.max(100, Math.round(basePence * multiplier / 100) * 100);
  if (!Number.isSafeInteger(proposedPence)) throw new Error('The proposed GBP price is outside the supported range.');
  return { basePence, cumulativeInflation: multiplier - 1, proposedPence };
}

export function roundLocalProBase(amount: number, majorUnit: number): number {
  const step = amount >= 40 * majorUnit ? 5 * majorUnit : majorUnit;
  return Math.max(step, Math.round(amount / step) * step);
}

const MAX_FX_AGE_MS = 7 * 86_400_000;

export interface GbpExchangeRate {
  currency: string;
  /** Target major currency units per GBP, multiplied by one million. */
  partsPerMillion: number;
  retrievedAt: string;
  source: string;
}

export function quoteLocalPrice(
  product: keyof typeof pricesInGbpPence,
  currency: string,
  exchange: GbpExchangeRate | undefined,
  settlementCurrencies: ReadonlySet<string>,
  customer: Parameters<typeof quoteProTax>[0],
  settings: Parameters<typeof quoteProTax>[1],
  nowMs: number,
  approvedProBasePence: number = PRO_BASE_PENCE,
  offer?: ReturnType<typeof resolveProOffer>,
) {
  if (!/^[A-Z]{3}$/.test(currency) || !settlementCurrencies.has(currency)) {
    throw new Error('This currency is unavailable for checkout.');
  }
  const minorUnitDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits!;
  const scale = 10 ** minorUnitDigits;
  if (offer && product !== 'pro') throw new Error('A Pro offer cannot apply to the Gemini plan.');
  const baseGbpPence = product === 'pro' ? offer?.gbpBasePence ?? approvedProBasePence : pricesInGbpPence.geminiMonthly;
  if (!Number.isSafeInteger(baseGbpPence) || baseGbpPence <= 0) throw new Error('Invalid GBP base price.');
  const rate = currency === 'GBP' ? null : exchange;
  let roundedBaseMinor: number = baseGbpPence;
  if (currency !== 'GBP') {
    const fetchedAt = Date.parse(rate?.retrievedAt ?? '');
    if (!rate || rate.currency !== currency || !rate.source.trim()
      || !Number.isFinite(nowMs) || !Number.isFinite(fetchedAt)
      || fetchedAt > nowMs || nowMs - fetchedAt > MAX_FX_AGE_MS
      || !Number.isSafeInteger(rate.partsPerMillion) || rate.partsPerMillion <= 0
      || !Number.isSafeInteger(baseGbpPence * rate.partsPerMillion * scale)) {
      throw new Error('A current exchange rate is required.');
    }
    const exactMinor = baseGbpPence * rate.partsPerMillion * scale / 100_000_000;
    if (product === 'pro') {
      roundedBaseMinor = roundLocalProBase(exactMinor, scale);
    } else {
      const step = Math.max(1, scale / 4);
      roundedBaseMinor = Math.max(step, Math.round(exactMinor / step) * step);
    }
    roundedBaseMinor = Math.round(roundedBaseMinor);
  }
  const tax = quoteProTax(customer, settings);
  const inclusive = tax.customerType === 'B2C' && settings.b2cPricing === 'inclusive';
  const discountMinor = Math.round(roundedBaseMinor * (offer?.discountBasisPoints ?? 0) / 10000);
  const saleBaseMinor = Math.max(1, roundedBaseMinor - discountMinor);
  const amounts = calculateTaxAmounts(saleBaseMinor, tax.rateBasisPoints, inclusive);
  return {
    product, currency, minorUnitDigits, baseGbpPence, roundedBaseMinor, saleBaseMinor,
    discountMinor: roundedBaseMinor - saleBaseMinor, offer: offer ?? null, exchangeRate: rate,
    jurisdiction: tax.jurisdiction, treatment: tax.treatment, rateBasisPoints: tax.rateBasisPoints,
    customerType: tax.customerType, vatNumber: tax.vatNumber, invoiceNotice: tax.invoiceNotice,
    verification: tax.verification, evidence: tax.evidence,
    ...amounts,
  };
}
