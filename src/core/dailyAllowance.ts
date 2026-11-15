/**
 * A per-day count kept on this device, used for the Free export allowance. It is an honest limit, not a lock: the count
 * lives in local storage, so it can be reset by someone determined. It must never block backup or recovery.
 */
export interface DailyUsage { day: string; count: number }

/** The local calendar day, so "per day" means the person's own day. */
export const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function parseUsage(raw: string | null): DailyUsage | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DailyUsage>;
    return typeof value.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.day) && Number.isSafeInteger(value.count) && value.count! >= 0
      ? { day: value.day, count: value.count! } : null;
  } catch {
    return null;
  }
}

/** How many more can be done today. A new day starts again from the full limit. */
export function remainingToday(usage: DailyUsage | null, now: Date, limit: number): number {
  const used = usage && usage.day === dayKey(now) ? usage.count : 0;
  return Math.max(0, limit - used);
}

export function recordUse(usage: DailyUsage | null, now: Date, amount: number): DailyUsage {
  const today = dayKey(now);
  return { day: today, count: (usage && usage.day === today ? usage.count : 0) + Math.max(0, Math.floor(amount)) };
}
