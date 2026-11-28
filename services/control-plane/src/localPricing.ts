/**
 * Pro prices in the currency Paddle charges for the visitor's country, for the website (GET /v1/pricing/local).
 *
 * Privacy: the visitor's internet address is used for one offline lookup on this server (DB-IP, networkCountry.ts) and
 * is then dropped. It is never stored, logged or sent to Paddle: Paddle is asked only for the country's prices
 * (POST /pricing-preview with `address.country_code`). Answers are cached by country for an hour, so most visits reach
 * Paddle not at all.
 *
 * Spoofing a forwarded address only changes which currency that visitor is shown. The checkout itself is priced by
 * Paddle from the buyer's real billing address, so nothing can be bought cheaper through this.
 */
import { isIP } from 'node:net';
import type { Request } from './http.ts';
import type { CountryLookup } from './networkCountry.ts';

export const LOCAL_PRICING_TTL_MS = 60 * 60_000;
/** How long a failed lookup for a country is remembered, so a Paddle outage is not asked again on every visit. */
export const LOCAL_PRICING_FAILURE_TTL_MS = 5 * 60_000;

/** `plus` is Pro Plus (£9.99 a month); absent until its Paddle price is set. */
export interface LocalPrices { currency: string; monthly: string; annual: string; plus?: string }

/** Paddle's preview for the two Pro prices in one country, or null when Paddle has no usable answer. */
export type PricePreview = (countryCode: string) => Promise<LocalPrices | null>;

/**
 * The visitor's address: the first valid entry in X-Forwarded-For (Firebase Hosting puts the visitor there and Cloud
 * Run appends its own hops after it), else the socket address. Private and local addresses are not a visitor's.
 */
export function visitorIp(headers: Request['headers'], socketIp?: string): string | null {
  const raw = headers['x-forwarded-for'];
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  const candidates = [...(value?.split(',').map((part) => part.trim()) ?? []), socketIp ?? ''];
  return candidates.find((ip) => isIP(ip) && !isPrivate(ip)) ?? null;
}

function isPrivate(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:10.') || v6.startsWith('::ffff:127.') || v6.startsWith('::ffff:192.168.');
}

/** Reads Paddle's pricing-preview answer: the currency and the two formatted totals, or null if anything is missing. */
export function readPricePreview(data: unknown, priceIds: { monthly: string; annual: string; plus?: string }): LocalPrices | null {
  const d = data as { currency_code?: unknown; details?: { line_items?: { price?: { id?: unknown }; formatted_totals?: { total?: unknown } }[] } } | null;
  const currency = d?.currency_code;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return null;
  const total = (id: string) => {
    const line = d?.details?.line_items?.find((item) => item.price?.id === id);
    const text = line?.formatted_totals?.total;
    return typeof text === 'string' && text.length > 0 && text.length <= 32 && /\d/.test(text) ? text : null;
  };
  const monthly = total(priceIds.monthly), annual = total(priceIds.annual);
  const plus = priceIds.plus ? total(priceIds.plus) : null;
  return monthly && annual ? { currency, monthly, annual, ...(plus ? { plus } : {}) } : null;
}

/**
 * The prices for one request. Null means "use the website's own fallback": unknown country, Paddle off, or Paddle
 * unreachable. Cached per country, never per address.
 */
export function localPricing(deps: { lookup: () => Promise<CountryLookup>; preview: PricePreview; now: () => number }) {
  const cache = new Map<string, { atMs: number; prices: LocalPrices | null }>();
  return async (req: Pick<Request, 'headers' | 'ip'>): Promise<LocalPrices | null> => {
    const ip = visitorIp(req.headers, req.ip);
    if (!ip) return null;
    let country: string | null;
    try { country = (await deps.lookup())(ip); } catch { return null; }
    if (!country || !/^[A-Z]{2}$/.test(country)) return null;
    const hit = cache.get(country);
    if (hit && deps.now() - hit.atMs < (hit.prices ? LOCAL_PRICING_TTL_MS : LOCAL_PRICING_FAILURE_TTL_MS)) return hit.prices;
    let prices: LocalPrices | null;
    try { prices = await deps.preview(country); } catch { prices = null; }
    cache.set(country, { atMs: deps.now(), prices });
    return prices;
  };
}
