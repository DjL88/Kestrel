export const PANEL_MIN = 260;
export const PANEL_MAX = 560;
export const PANEL_DEFAULT = 320;

export function clampPanelWidth(value: unknown, available = Infinity): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : PANEL_DEFAULT;
  // Always leave room for the photograph.
  return Math.round(Math.max(PANEL_MIN, Math.min(PANEL_MAX, number, available * 0.6)));
}
