export const UK_VAT_THRESHOLD_PENCE = 9_000_000;
export const UK_VAT_WARNING_PENCE = 7_500_000;

export interface TurnoverEntry {
  supplyDate: string;
  country: string;
  netPence: number;
}

const dayMs = 86_400_000;
const isoDay = (milliseconds: number) => new Date(milliseconds).toISOString().slice(0, 10);

export function ukTurnoverMetrics(
  entries: readonly TurnoverEntry[],
  asOf: string,
  forecast?: { recognisedOn: string; next30DaysPence: number },
) {
  const today = new Date(asOf + 'T00:00:00Z');
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const day = today.getUTCDate();
  const monthEnd = Date.UTC(year, month + 1, 0);
  const anniversaryDay = Math.min(day, new Date(Date.UTC(year - 1, month + 1, 0)).getUTCDate());
  const startExclusive = isoDay(Date.UTC(year - 1, month, anniversaryDay));
  const uk = entries.filter(entry => entry.country === 'GB');
  const sum = (start: string, end: string) => uk.reduce((total, entry) =>
    entry.supplyDate > start && entry.supplyDate <= end ? total + entry.netPence : total, 0);
  const rollingPence = sum(startExclusive, asOf);
  // HMRC applies the backward-looking liability test at the end of each calendar month.
  const lastClosedMonth = today.getTime() === monthEnd ? monthEnd : Date.UTC(year, month, 0);
  const lastClosedMonthDate = new Date(lastClosedMonth);
  const closedYear = lastClosedMonthDate.getUTCFullYear();
  const closedMonth = lastClosedMonthDate.getUTCMonth();
  const closedMonthPence = sum(isoDay(Date.UTC(closedYear - 1, closedMonth + 1, 0)), isoDay(lastClosedMonth));
  const backward = closedMonthPence > UK_VAT_THRESHOLD_PENCE ? {
    notificationDue: isoDay(lastClosedMonth + 30 * dayMs),
    effectiveDate: isoDay(Date.UTC(closedYear, closedMonth + 2, 1)),
  } : null;
  const forward = forecast && forecast.next30DaysPence > UK_VAT_THRESHOLD_PENCE ? {
    notificationDue: isoDay(Date.parse(forecast.recognisedOn + 'T00:00:00Z') + 30 * dayMs),
    effectiveDate: forecast.recognisedOn,
  } : null;
  const state = backward || forward ? 'breach'
    : rollingPence >= UK_VAT_WARNING_PENCE ? 'warning' : 'normal';
  return { asOf, rollingPence, closedMonthPence, forecastPence: forecast?.next30DaysPence ?? null, state, backward, forward };
}
