// Website prices from the one pricing matrix the owner edits in Admin → Prices (src/core/pricingMatrix.ts), served by
// the control plane at /v1/pricing on this site's own address. Pure helpers plus one fetch: no price is typed here.
// Until the matrix answers (or if it cannot), the page shows the GBP starting prices below, which match the matrix
// default; a visitor whose country has no currency in the matrix sees GBP, which is what Paddle charges them.

/** The matrix's starting prices (DEFAULT_PRICING), in minor units. Used only until /v1/pricing answers. */
export const FALLBACK = Object.freeze({
  version: 1, base: 'GBP', updatedAt: null,
  currencies: { GBP: { digits: 2, 'pro.monthly': 299, 'pro.annual': 2999 } },
  regions: { GB: 'GBP', IM: 'GBP', JE: 'GBP', GG: 'GBP' },
});

const ITEMS = ['pro.monthly', 'pro.annual'];
const ok = (n) => Number.isSafeInteger(n) && n > 0;

/** Checks a /v1/pricing answer; null when it is not usable (then keep FALLBACK). */
export function readPricing(body) {
  if (!body || body.version !== 1 || !body.currencies || typeof body.currencies !== 'object') return null;
  const currencies = {};
  for (const [code, row] of Object.entries(body.currencies)) {
    if (/^[A-Z]{3}$/.test(code) && row && Number.isInteger(row.digits) && ITEMS.every((item) => ok(row[item]))) currencies[code] = row;
  }
  if (!currencies.GBP) return null;
  const regions = {};
  for (const [country, code] of Object.entries(body.regions || {})) if (/^[A-Z]{2}$/.test(country) && currencies[code]) regions[country] = code;
  return { version: 1, base: 'GBP', updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : null, currencies, regions };
}

/** The currency for a country code (GB, FR…); GBP when the matrix has none for it. */
export function currencyFor(pricing, region) {
  const code = region ? pricing.regions[String(region).toUpperCase()] : undefined;
  return code && pricing.currencies[code] ? code : 'GBP';
}

/** "£2.99", "€35", "SEK 409": whole amounts without decimals. item is 'pro.monthly' or 'pro.annual'. */
export function priceText(pricing, currency, item, locale = 'en-GB') {
  const row = pricing.currencies[currency] || pricing.currencies.GBP;
  const code = pricing.currencies[currency] ? currency : 'GBP';
  const amount = row[item] / 10 ** row.digits;
  const digits = Number.isInteger(amount) ? 0 : row.digits;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: ['GBP', 'EUR', 'USD'].includes(code) ? 'narrowSymbol' : 'symbol', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
  } catch { return `${code} ${amount.toFixed(digits)}`; }
}

/** Fetches the live matrix prices; resolves to FALLBACK on any failure. */
export async function loadPricing(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl('/v1/pricing', { credentials: 'omit' });
    return (response.ok && readPricing(await response.json())) || FALLBACK;
  } catch { return FALLBACK; }
}

/**
 * Checks a /v1/pricing/local answer: Paddle's own formatted prices for the visitor's country, e.g.
 * { currency: 'EUR', monthly: '€3.99', annual: '€35.00' }. Null when it is not usable.
 */
export function readLocalPrices(body) {
  if (!body || typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) return null;
  const good = (text) => typeof text === 'string' && text.length > 0 && text.length <= 32 && /\d/.test(text) && !/[<>]/.test(text);
  return good(body.monthly) && good(body.annual) ? { currency: body.currency, monthly: body.monthly, annual: body.annual } : null;
}

/**
 * Prices in the currency Paddle charges for the visitor's country. The server works the country out from the
 * visitor's internet address and drops the address; Paddle is asked only about the country. Null on any failure,
 * and then the page uses the browser-language currency (currencyFor) as before.
 */
export async function loadLocalPrices(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl('/v1/pricing/local', { credentials: 'omit' });
    return response.ok ? readLocalPrices(await response.json()) : null;
  } catch { return null; }
}
