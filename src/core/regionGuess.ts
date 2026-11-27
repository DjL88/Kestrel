/**
 * Which country to show prices for, before Paddle's checkout (which charges by the buyer's real country) takes over.
 * The desktop app's web view reports the Windows display language, which is often en-US on a UK computer, so the time
 * zone the person set comes first: it names where the computer is. Only zones that belong to one country are used;
 * anything else falls back to the language's region (en-GB → GB). Pure: no lookup, no network.
 */
const ZONE_REGION: Record<string, string> = {
  'Europe/London': 'GB', 'Europe/Belfast': 'GB', 'Europe/Guernsey': 'GG', 'Europe/Jersey': 'JE', 'Europe/Isle_of_Man': 'IM',
  'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT',
  'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Vienna': 'AT', 'Europe/Lisbon': 'PT', 'Europe/Helsinki': 'FI',
  'Europe/Athens': 'GR', 'Europe/Luxembourg': 'LU', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK',
  'Europe/Zurich': 'CH', 'Europe/Warsaw': 'PL', 'Asia/Tokyo': 'JP', 'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU',
  'Pacific/Auckland': 'NZ', 'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US',
  'America/Phoenix': 'US', 'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA',
};

export function regionFromTimeZone(zone: string | null | undefined): string | null {
  return zone ? ZONE_REGION[zone] ?? null : null;
}

export function regionFromLanguages(tags: readonly string[]): string | null {
  for (const tag of tags) {
    try { const region = new Intl.Locale(tag).region; if (region) return region; } catch { /* not a language tag */ }
  }
  return null;
}

/** The time zone's country when it names one, else the first language that names a region, else unknown. */
export function guessRegion(zone: string | null | undefined, tags: readonly string[]): string | null {
  return regionFromTimeZone(zone) ?? regionFromLanguages(tags);
}
