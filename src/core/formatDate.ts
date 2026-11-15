const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

/** British date such as "15 Nov 2026". Times are added for today and yesterday's context only when asked. */
export function formatProjectDate(ms: number | undefined, withTime = false): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return 'unknown';
  const date = new Date(ms);
  return withTime ? `${DATE.format(date)}, ${TIME.format(date)}` : DATE.format(date);
}
