/**
 * A local record of how long "Save to a folder" takes to show its folder picker (owner's report: about 60 s on Windows).
 * It separates the app's own share (from "Save files" to asking Windows for the picker) from the time until the picker
 * answered, which includes the picker opening and the person choosing. Shown only in Tasks on this device; never sent.
 */
export interface PickerTiming { clickedAt: number; askedAt: number; answeredAt: number }

const seconds = (ms: number) => Math.max(0, ms) / 1000;

/** The two durations in seconds, rounded to tenths; null when the times are not in order. */
export function pickerDurations(timing: PickerTiming): { appSeconds: number; pickerSeconds: number } | null {
  const { clickedAt, askedAt, answeredAt } = timing;
  if (![clickedAt, askedAt, answeredAt].every(Number.isFinite) || askedAt < clickedAt || answeredAt < askedAt) return null;
  return { appSeconds: Math.round(seconds(askedAt - clickedAt) * 10) / 10, pickerSeconds: Math.round(seconds(answeredAt - askedAt) * 10) / 10 };
}
