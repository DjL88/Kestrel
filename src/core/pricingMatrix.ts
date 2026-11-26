/**
 * The one pricing matrix (owner, 26 Nov 2026): every price InFlight shows or charges comes from here, by plan, period
 * and currency. The owner edits it in Admin → Prices. Each currency is either converted from the GBP base (at a stored
 * ECB reference rate, rounded to a tidy price point) or set by hand with an override. The control plane serves the
 * result at /v1/pricing for the website and the app, and pushes it to the Paddle prices so checkout charges the same.
 *
 * Pure: no network, no storage. All money is whole minor units (pence, cents, öre…), so nothing drifts.
 */

/** What can be priced. Basic is free and never in the matrix. */
export const PRICE_ITEMS = ['pro.monthly', 'pro.annual'] as const;
export type PriceItem = typeof PRICE_ITEMS[number];
export const PRICE_ITEM_LABELS: Record<PriceItem, string> = { 'pro.monthly': 'Pro, monthly', 'pro.annual': 'Pro, yearly' };

/**
 * Currencies Paddle can charge in (Paddle Billing's supported currencies). A currency outside this list cannot be in
 * the matrix, because checkout could not charge it: Iceland, for example, is shown and charged in euros.
 */
export const PADDLE_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'HKD', 'SGD', 'SEK', 'ARS', 'BRL', 'CNY', 'COP',
  'CZK', 'DKK', 'HUF', 'ILS', 'INR', 'KRW', 'MXN', 'NOK', 'NZD', 'PLN', 'RUB', 'THB', 'TRY', 'TWD', 'UAH', 'VND', 'ZAR'] as const;

const EURO_COUNTRIES = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MC MT NL PT SI SK SM VA AD ME XK IS'.split(' ');
/**
 * Which countries pay in which currency. Paddle uses this (as country price overrides) and so does the website, so the
 * price a visitor sees is the price Paddle charges them. Any country not listed pays the GBP base.
 */
export const CURRENCY_COUNTRIES: Readonly<Record<string, readonly string[]>> = {
  GBP: ['GB', 'IM', 'JE', 'GG'],
  EUR: EURO_COUNTRIES,
  USD: ['US'],
  CAD: ['CA'],
  AUD: ['AU'],
  NZD: ['NZ'],
  CHF: ['CH', 'LI'],
  DKK: ['DK'],
  SEK: ['SE'],
  NOK: ['NO'],
  JPY: ['JP'],
  PLN: ['PL'],
  CZK: ['CZ'],
  HUF: ['HU'],
  SGD: ['SG'],
  HKD: ['HK'],
  ZAR: ['ZA'],
  INR: ['IN'],
  BRL: ['BR'],
  MXN: ['MX'],
};

/**
 * How a converted price is tidied.
 * - charm: a price point people expect: under 20 → x.99; under 100 → a whole number; under 1,000 → ending in 9
 *   (299, 449); above → ending in 90 (4,490). For currencies without minor units the same steps apply to whole units.
 * - whole: the nearest whole unit.
 * - exact: the conversion to the minor unit, untidied.
 */
export type Rounding = 'charm' | 'whole' | 'exact';
export const ROUNDINGS: readonly Rounding[] = ['charm', 'whole', 'exact'];

export interface CurrencyRule {
  rounding: Rounding;
  /** Hand-set prices in minor units. An override always wins over the conversion. */
  overrides: Partial<Record<PriceItem, number>>;
}

export interface PricingMatrix {
  version: 1;
  /** The GBP base, in pence. Every converted currency starts from here. */
  base: Record<PriceItem, number>;
  /** ECB reference rates, as units of each currency per £1, with the day they were published. */
  rates: { date: string | null; perGbp: Record<string, number> };
  /** The currencies on offer besides GBP. */
  currencies: Record<string, CurrencyRule>;
  updatedAt?: string;
  updatedBy?: string;
}

/**
 * The matrix before anyone edits it in Admin: the GBP prices only (owner, 26 Nov 2026), and the other currencies
 * listed with no rate yet, so nothing is guessed. Refresh the rates in Admin → Prices to convert them.
 */
export const DEFAULT_PRICING: PricingMatrix = {
  version: 1,
  base: { 'pro.monthly': 299, 'pro.annual': 2900 },
  rates: { date: null, perGbp: {} },
  currencies: Object.fromEntries(['EUR', 'USD', 'CAD', 'AUD', 'NZD', 'CHF', 'DKK', 'SEK', 'NOK']
    .map((currency) => [currency, { rounding: 'charm', overrides: {} }])) as Record<string, CurrencyRule>,
};

const MAX_MINOR = 100_000_000;
const isCode = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const isMinor = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= MAX_MINOR;

/** Digits after the decimal point for a currency (2 for GBP, 0 for JPY), from the platform's ISO 4217 data. */
export function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch { return 2; }
}

/**
 * Checks a matrix from Admin (or storage) and returns a clean copy, or throws an Error whose message says what is wrong
 * in plain words. Unknown fields are dropped.
 */
export function parsePricingMatrix(input: unknown): PricingMatrix {
  const fail = (message: string): never => { throw new Error(message); };
  if (!input || typeof input !== 'object') fail('The price matrix is missing.');
  const raw = input as Record<string, unknown>;
  const base = (raw.base ?? {}) as Record<string, unknown>;
  const cleanBase = {} as Record<PriceItem, number>;
  for (const item of PRICE_ITEMS) {
    if (!isMinor(base[item])) fail(`${PRICE_ITEM_LABELS[item]} needs a GBP price above zero, in pence.`);
    cleanBase[item] = base[item] as number;
  }
  const rawRates = (raw.rates ?? {}) as Record<string, unknown>;
  const date = rawRates.date ?? null;
  if (date !== null && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) fail('The exchange-rate date must be yyyy-mm-dd.');
  const perGbp: Record<string, number> = {};
  for (const [currency, rate] of Object.entries((rawRates.perGbp ?? {}) as Record<string, unknown>)) {
    if (!isCode(currency) || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 1_000_000) fail(`The exchange rate for ${currency} is not a positive number.`);
    perGbp[currency] = rate as number;
  }
  const currencies: Record<string, CurrencyRule> = {};
  const rawCurrencies = (raw.currencies ?? {}) as Record<string, unknown>;
  if (Object.keys(rawCurrencies).length > 32) fail('At most 32 currencies can be offered.');
  for (const [currency, value] of Object.entries(rawCurrencies)) {
    if (!isCode(currency)) fail(`"${currency}" is not a three-letter currency code.`);
    if (currency === 'GBP') continue;
    if (!(PADDLE_CURRENCIES as readonly string[]).includes(currency)) fail(`Paddle cannot charge in ${currency}, so it cannot be offered.`);
    const rule = (value ?? {}) as Record<string, unknown>;
    const rounding = rule.rounding ?? 'charm';
    if (!ROUNDINGS.includes(rounding as Rounding)) fail(`Choose how ${currency} prices are rounded.`);
    const overrides: Partial<Record<PriceItem, number>> = {};
    for (const [item, minor] of Object.entries((rule.overrides ?? {}) as Record<string, unknown>)) {
      if (!(PRICE_ITEMS as readonly string[]).includes(item)) fail(`"${item}" is not a price in the matrix.`);
      if (minor === null || minor === undefined) continue;
      if (!isMinor(minor)) fail(`The ${currency} override for ${PRICE_ITEM_LABELS[item as PriceItem]} must be above zero, in minor units.`);
      overrides[item as PriceItem] = minor as number;
    }
    currencies[currency] = { rounding: rounding as Rounding, overrides };
  }
  const out: PricingMatrix = { version: 1, base: cleanBase, rates: { date: date as string | null, perGbp }, currencies };
  if (typeof raw.updatedAt === 'string') out.updatedAt = raw.updatedAt;
  if (typeof raw.updatedBy === 'string') out.updatedBy = raw.updatedBy;
  return out;
}

/** Tidies an amount in minor units to a price point (see Rounding). Never returns less than one step. */
export function tidyPrice(minor: number, digits: number, rounding: Rounding): number {
  const unit = 10 ** digits;
  if (rounding === 'exact') return Math.max(1, Math.round(minor));
  const major = minor / unit;
  if (rounding === 'whole') return Math.max(1, Math.round(major)) * unit;
  // charm: nearest point of the form (k × step − less), k ≥ 1.
  const [step, less] = major < 20 ? [1, digits > 0 ? 1 : 0] : major < 100 ? [1, 0] : major < 1000 ? [10, unit] : [100, 10 * unit];
  const stepMinor = step * unit;
  const k = Math.max(1, Math.round((minor + less) / stepMinor));
  return k * stepMinor - less;
}

export interface PriceCell { minor: number; source: 'base' | 'converted' | 'override' }
export interface CurrencyPrices {
  currency: string;
  digits: number;
  /** Absent when the currency has no rate yet and no override for that item: it is not offered until it has one. */
  prices: Partial<Record<PriceItem, PriceCell>>;
  /** The conversion before tidying, for Admin to show (minor units, may be fractional). */
  converted: Partial<Record<PriceItem, number>>;
}

/** Every price in the matrix, GBP first. A currency appears only when every item has a price. */
export function computePrices(matrix: PricingMatrix): { all: CurrencyPrices[]; offered: CurrencyPrices[] } {
  const all: CurrencyPrices[] = [{
    currency: 'GBP', digits: 2, converted: { ...matrix.base },
    prices: Object.fromEntries(PRICE_ITEMS.map((item) => [item, { minor: matrix.base[item], source: 'base' }])),
  }];
  for (const [currency, rule] of Object.entries(matrix.currencies).sort(([a], [b]) => a.localeCompare(b))) {
    if (currency === 'GBP') continue;
    const digits = minorDigits(currency);
    const rate = matrix.rates.perGbp[currency];
    const prices: Partial<Record<PriceItem, PriceCell>> = {};
    const converted: Partial<Record<PriceItem, number>> = {};
    for (const item of PRICE_ITEMS) {
      if (rate) converted[item] = matrix.base[item] / 100 * rate * 10 ** digits;
      const override = rule.overrides[item];
      if (override) prices[item] = { minor: override, source: 'override' };
      else if (converted[item] !== undefined) prices[item] = { minor: tidyPrice(converted[item]!, digits, rule.rounding), source: 'converted' };
    }
    all.push({ currency, digits, prices, converted });
  }
  return { all, offered: all.filter((row) => PRICE_ITEMS.every((item) => row.prices[item])) };
}

/** What /v1/pricing serves: offered currencies only, and which countries pay in which. */
export interface PublicPricing {
  version: 1;
  base: 'GBP';
  updatedAt: string | null;
  currencies: Record<string, { digits: number } & Record<PriceItem, number>>;
  /** Country (ISO 3166 alpha-2) → currency. Countries not listed pay GBP. */
  regions: Record<string, string>;
}

export function publicPricing(matrix: PricingMatrix): PublicPricing {
  const { offered } = computePrices(matrix);
  const currencies: PublicPricing['currencies'] = {};
  const regions: Record<string, string> = {};
  for (const row of offered) {
    currencies[row.currency] = { digits: row.digits, ...Object.fromEntries(PRICE_ITEMS.map((item) => [item, row.prices[item]!.minor])) } as PublicPricing['currencies'][string];
    for (const country of CURRENCY_COUNTRIES[row.currency] ?? []) regions[country] = row.currency;
  }
  return { version: 1, base: 'GBP', updatedAt: matrix.updatedAt ?? null, currencies, regions };
}

/** Reads a /v1/pricing answer defensively (it crosses the network). Null when it is not usable. */
export function readPublicPricing(input: unknown): PublicPricing | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const currencies = raw.currencies as Record<string, Record<string, unknown>> | undefined;
  if (raw.version !== 1 || !currencies || typeof currencies !== 'object' || !currencies.GBP) return null;
  const clean: PublicPricing['currencies'] = {};
  for (const [currency, row] of Object.entries(currencies)) {
    if (!isCode(currency) || !row || !Number.isInteger(row.digits) || !PRICE_ITEMS.every((item) => isMinor(row[item]))) continue;
    clean[currency] = row as PublicPricing['currencies'][string];
  }
  if (!clean.GBP) return null;
  const regions: Record<string, string> = {};
  for (const [country, currency] of Object.entries((raw.regions ?? {}) as Record<string, unknown>)) {
    if (/^[A-Z]{2}$/.test(country) && typeof currency === 'string' && clean[currency]) regions[country] = currency;
  }
  return { version: 1, base: 'GBP', updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null, currencies: clean, regions };
}

/** The currency for a country, from the served table; GBP when the country is not listed (what Paddle charges). */
export function currencyForRegion(pricing: PublicPricing, region: string | null | undefined): string {
  const currency = region ? pricing.regions[region.toUpperCase()] : undefined;
  return currency && pricing.currencies[currency] ? currency : 'GBP';
}

/** "£2.99", "€34", "kr 299": whole amounts without decimals, others with exactly the currency's digits. */
export function formatPrice(minor: number, currency: string, digits: number, locale = 'en-GB'): string {
  const amount = minor / 10 ** digits;
  const shown = Number.isInteger(amount) ? 0 : digits;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: ['GBP', 'EUR', 'USD'].includes(currency) ? 'narrowSymbol' : 'symbol', minimumFractionDigits: shown, maximumFractionDigits: shown }).format(amount);
  } catch { return `${currency} ${amount.toFixed(shown)}`; }
}

// ---- Paddle ------------------------------------------------------------------------------------------------------

/** The parts of a Paddle price we read and write. */
export interface PaddlePriceView {
  id: string;
  unit_price: { amount: string; currency_code: string };
  unit_price_overrides?: { country_codes: string[]; unit_price: { amount: string; currency_code: string } }[];
}

/** The Paddle price body for one item: the GBP base, plus one country override per other offered currency. */
export function paddlePriceUpdate(matrix: PricingMatrix, item: PriceItem) {
  const { offered } = computePrices(matrix);
  return {
    unit_price: { amount: String(matrix.base[item]), currency_code: 'GBP' },
    unit_price_overrides: offered.filter((row) => row.currency !== 'GBP' && (CURRENCY_COUNTRIES[row.currency] ?? []).length)
      .map((row) => ({ country_codes: [...CURRENCY_COUNTRIES[row.currency]!], unit_price: { amount: String(row.prices[item]!.minor), currency_code: row.currency } })),
  };
}

export interface PaddleDifference { item: PriceItem; currency: string; matrix: number | null; paddle: number | null }

/**
 * Where Paddle would charge something other than the matrix: a wrong amount, a currency Paddle charges that the matrix
 * does not offer, or one the matrix offers that Paddle does not. Empty means checkout and the matrix agree.
 */
export function paddleDifferences(matrix: PricingMatrix, item: PriceItem, price: PaddlePriceView): PaddleDifference[] {
  const wanted = new Map<string, number>();
  for (const row of computePrices(matrix).offered) {
    if (row.currency === 'GBP' || (CURRENCY_COUNTRIES[row.currency] ?? []).length) wanted.set(row.currency, row.prices[item]!.minor);
  }
  const charged = new Map<string, number>();
  if (price.unit_price.currency_code !== 'GBP') charged.set('GBP', NaN);
  charged.set(price.unit_price.currency_code, Number(price.unit_price.amount));
  for (const override of price.unit_price_overrides ?? []) {
    const amount = Number(override.unit_price.amount);
    const code = override.unit_price.currency_code;
    // Every country of a currency must be overridden to the same amount, or some buyers pay another price.
    const covers = (CURRENCY_COUNTRIES[code] ?? []).every((country) => override.country_codes.includes(country));
    const previous = charged.get(code);
    charged.set(code, covers && (previous === undefined || previous === amount) ? amount : NaN);
  }
  const differences: PaddleDifference[] = [];
  for (const currency of new Set([...wanted.keys(), ...charged.keys()])) {
    const want = wanted.get(currency) ?? null;
    const have = charged.has(currency) ? charged.get(currency)! : null;
    if (want !== have) differences.push({ item, currency, matrix: want, paddle: have === null || Number.isNaN(have) ? null : have });
  }
  return differences.sort((a, b) => a.currency.localeCompare(b.currency));
}
