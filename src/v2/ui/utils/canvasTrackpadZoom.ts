/** Desktop precision-touchpad pinch is exposed as a ctrlKey wheel event by Chromium.
 * Keep ordinary two-finger scrolling native; only a zoom-modified wheel is handled. */
export function trackpadZoomFactor(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY) || !Number.isInteger(deltaMode) || deltaMode < 0 || deltaMode > 2) return 1;
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 600 : 1);
  return Math.exp(-Math.max(-120, Math.min(120, pixels)) * 0.008);
}

export function nextCanvasZoom(current: number, deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(current) || current <= 0) return 1;
  return Math.max(0.25, Math.min(8, current * trackpadZoomFactor(deltaY, deltaMode)));
}

/** Retain the same image coordinate beneath the gesture centre after zoom.
 * The stage scrolls; crop and image recipe coordinates are never touched. */
export function zoomAnchorScroll(
  scroll: number, pointerOffset: number, previousZoom: number, nextZoom: number,
): number {
  if (!Number.isFinite(scroll) || !Number.isFinite(pointerOffset) || !Number.isFinite(previousZoom) || previousZoom <= 0 || !Number.isFinite(nextZoom) || nextZoom <= 0) return Number.isFinite(scroll) ? Math.max(0, scroll) : 0;
  const anchored = (scroll + pointerOffset) * (nextZoom / previousZoom) - pointerOffset;
  // Finite inputs can still overflow during multiplication. Preserve the last
  // usable scroll instead of handing Infinity to the DOM scroll position.
  return Number.isFinite(anchored) ? Math.max(0, anchored) : Math.max(0, scroll);
}
