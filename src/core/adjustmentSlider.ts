/**
 * The visible copper segment begins at the neutral value, not at the minimum:
 * darkening is as legible as brightening. Geometry never changes the edit data.
 */
export interface AdjustmentFill {
  start: number;
  width: number;
  neutral: number;
  current: number;
}
export function adjustmentFill(value: number, min: number, max: number, neutral = 0): AdjustmentFill {
  if (![value, min, max, neutral].every(Number.isFinite) || max <= min) {
    return { start: 0, width: 0, neutral: 0, current: 0 };
  }
  const percentage = (input: number) => Math.max(0, Math.min(100, (input - min) / (max - min) * 100));
  const origin = percentage(neutral);
  const end = percentage(value);
  return {
    start: Math.min(origin, end),
    width: Math.abs(end - origin),
    neutral: origin,
    current: end,
  };
}

/** Displays the underlying slider number, not an exaggerated effect estimate. */
export function signedAdjustment(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return '0';
  const magnitude = String(Math.abs(rounded));
  return (rounded < 0 ? '−' : '+') + magnitude;
}
