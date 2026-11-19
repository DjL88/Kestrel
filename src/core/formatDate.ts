import { activeLanguage } from './locale';

const cache = new Map<string, Intl.DateTimeFormat>();
function formatter(kind: 'date' | 'time' | 'clock' | 'captured') {
  const language = activeLanguage();
  const key = `${language}:${kind}`;
  let found = cache.get(key);
  if (!found) {
    const options: Intl.DateTimeFormatOptions = kind === 'date' ? { day: 'numeric', month: 'short', year: 'numeric' }
      : kind === 'time' ? { hour: '2-digit', minute: '2-digit' }
      : kind === 'clock' ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
      : { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
    found = new Intl.DateTimeFormat(language, options);
    cache.set(key, found);
  }
  return found;
}

/** A date such as "15 Nov 2026" in the chosen language (British English by default), optionally with the time. */
export function formatProjectDate(ms: number | undefined, withTime = false): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return 'unknown';
  const date = new Date(ms);
  return withTime ? `${formatter('date').format(date)}, ${formatter('time').format(date)}` : formatter('date').format(date);
}

/** Time of day such as "14:05:09", for the edit history. */
export function formatClock(ms: number): string {
  return Number.isFinite(ms) && ms > 0 ? formatter('clock').format(new Date(ms)) : '';
}

/**
 * When a photo was taken, in the chosen language: "19 Nov 2026, 20:46:46" in British English. It used to follow the
 * browser's own language, so a British photographer on a US-English Windows saw "Nov 19, 2026, 08:46:46 PM".
 */
export function formatCapturedAt(ms: number): string {
  return formatter('captured').format(new Date(ms));
}
