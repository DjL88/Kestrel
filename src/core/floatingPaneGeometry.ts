/** Pure viewport constraints for a device-local floating workspace panel. */
export interface PaneRect { x: number; y: number; width: number; height: number }
export const FLOATING_PANE_GAP = 12;
export const FLOATING_PANE_MIN_WIDTH = 280;
export const FLOATING_PANE_MIN_HEIGHT = 250;

export function clampPaneRect(rect: PaneRect, viewport: { width: number; height: number }): PaneRect {
  const vw = Math.max(1, Number.isFinite(viewport.width) ? viewport.width : 1);
  const vh = Math.max(1, Number.isFinite(viewport.height) ? viewport.height : 1);
  const maxWidth = Math.max(1, vw - FLOATING_PANE_GAP * 2);
  const maxHeight = Math.max(1, vh - FLOATING_PANE_GAP * 2);
  // Narrow viewport safety: never create a desktop window wider than the screen.
  const width = Math.min(Math.max(1, Number.isFinite(rect.width) ? rect.width : 360, FLOATING_PANE_MIN_WIDTH), maxWidth);
  const height = Math.min(Math.max(1, Number.isFinite(rect.height) ? rect.height : 560, FLOATING_PANE_MIN_HEIGHT), maxHeight);
  const x = Math.max(0, Math.min(Number.isFinite(rect.x) ? rect.x : FLOATING_PANE_GAP, vw - width));
  const y = Math.max(0, Math.min(Number.isFinite(rect.y) ? rect.y : FLOATING_PANE_GAP, vh - height));
  return { x, y, width, height };
}
