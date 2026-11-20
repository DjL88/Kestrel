import { calculateTaxAmounts, PRO_BASE_PENCE, quoteProTax } from './tax.ts';

const pricesInGbpPence = { pro: PRO_BASE_PENCE, geminiMonthly: 99 } as const;
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
) {
  if (!/^[A-Z]{3}$/.test(currency) || !settlementCurrencies.has(currency)) {
    throw new Error('This currency is unavailable for checkout.');
  }
  const minorUnitDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits!;
  const scale = 10 ** minorUnitDigits;
  const baseGbpPence = pricesInGbpPence[product];
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
    // One-time prices round to a whole unit. Smaller monthly amounts use
    // quarter-unit steps so, for example, £0.99 can become €1.25.
    const step = product === 'geminiMonthly' ? Math.max(1, scale / 4) : scale;
    roundedBaseMinor = Math.max(step, Math.round(exactMinor / step) * step);
    roundedBaseMinor = Math.round(roundedBaseMinor);
  }
  const tax = quoteProTax(customer, settings);
  const inclusive = tax.customerType === 'B2C' && settings.b2cPricing === 'inclusive';
  const amounts = calculateTaxAmounts(roundedBaseMinor, tax.rateBasisPoints, inclusive);
  return {
    product, currency, minorUnitDigits, baseGbpPence, roundedBaseMinor, exchangeRate: rate,
    jurisdiction: tax.jurisdiction, treatment: tax.treatment, rateBasisPoints: tax.rateBasisPoints,
    customerType: tax.customerType, vatNumber: tax.vatNumber, invoiceNotice: tax.invoiceNotice,
    verification: tax.verification, evidence: tax.evidence,
    ...amounts,
  };
}
