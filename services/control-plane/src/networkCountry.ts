import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isIP } from 'node:net';
import type { Request } from './http.ts';

/**
 * The buyer's address as Cloud Run's front end saw it. Google appends the connecting address as the LAST
 * X-Forwarded-For entry; anything before it was written by the client and is ignored.
 * The address is used for one lookup and never stored; only the resulting country is kept with the order.
 */
export function cloudRunClientIp(headers: Request['headers']): string | null {
  const raw = headers['x-forwarded-for'];
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  const last = value?.split(',').map((part) => part.trim()).filter(Boolean).pop();
  return last && isIP(last) ? last : null;
}

export type CountryLookup = (ip: string) => string | null;

/** Country of the request's network address, or null when unknown (never a guess). */
export function networkCountryFrom(lookup: CountryLookup) {
  return (req: Pick<Request, 'headers'>): string | null => {
    const ip = cloudRunClientIp(req.headers);
    if (!ip) return null;
    const country = lookup(ip);
    return country && /^[A-Z]{2}$/.test(country) ? country : null;
  };
}

/**
 * Offline lookup in the DB-IP "IP to Country Lite" database (CC BY 4.0, attribution: "IP Geolocation by DB-IP",
 * https://db-ip.com), pinned in package.json. No network call per request.
 */
export async function dbipCountryLookup(): Promise<CountryLookup> {
  const { Reader } = await import('mmdb-lib');
  const file = createRequire(import.meta.url).resolve('@ip-location-db/dbip-country-mmdb/dbip-country.mmdb');
  const reader = new Reader(readFileSync(file));
  return (ip) => {
    const hit = reader.get(ip) as { country_code?: unknown } | null;
    return typeof hit?.country_code === 'string' ? hit.country_code : null;
  };
}
