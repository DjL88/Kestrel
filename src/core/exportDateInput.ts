/** A local date/time must be real before starting an expensive batch export. */
export function parseCustomExportDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '0'] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const [y, m, d, h, min, sec] = parts;
  const date = new Date(0);
  date.setFullYear(y, m - 1, d);
  date.setHours(h, min, sec, 0);
  // Date normalises impossible dates and times, so reject those rollovers.
  return Number.isFinite(date.getTime()) &&
    date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d &&
    date.getHours() === h && date.getMinutes() === min && date.getSeconds() === sec ? date : null;
}
