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

/**
 * Where a panel first opens. It stays clear of the docked panel (so the tab strip it came from is still reachable)
 * and each further panel is nudged so several undocked tabs do not pile on top of one another.
 * `side` is the side the docked panel is on; `avoidPx` is that panel's width.
 */
export function defaultPaneRect(
  viewport: { width: number; height: number },
  side: 'left' | 'right',
  options: { avoidPx?: number; index?: number } = {},
): PaneRect {
  const width = 360, height = 570, step = 32;
  const avoid = Math.max(0, options.avoidPx ?? 0);
  const nudge = Math.min(Math.max(0, options.index ?? 0), 5) * step;
  const x = side === 'right'
    ? viewport.width - avoid - width - FLOATING_PANE_GAP * 2 - nudge
    : avoid + FLOATING_PANE_GAP * 2 + nudge;
  return clampPaneRect({ x, y: 72 + nudge, width, height }, viewport);
}
