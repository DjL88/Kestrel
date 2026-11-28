/** Desktop precision-touchpad pinch is exposed as a ctrlKey wheel event by Chromium.
 * Keep ordinary two-finger scrolling native; only a zoom-modified wheel is handled. */
export function trackpadZoomFactor(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY) || !Number.isInteger(deltaMode) || deltaMode < 0 || deltaMode > 2) return 1;
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 600 : 1);
  return Math.exp(-Math.max(-120, Math.min(120, pixels)) * 0.008);
}

/**
 * How far in the canvas may zoom, as a multiple of Fit: at least 8×, and always far enough for 400% of the photo's own
 * pixels. A fixed 8× (and the store's 16×) stopped a 45 MP photo short of 100% in a small window (87% to 98%).
 */
export function maxCanvasZoom(fitScale: number | null): number {
  return fitScale && Number.isFinite(fitScale) && fitScale > 0 ? Math.max(8, 4 / fitScale) : 8;
}

export function nextCanvasZoom(current: number, deltaY: number, deltaMode = 0, max = 8): number {
  if (!Number.isFinite(current) || current <= 0) return 1;
  return Math.max(0.25, Math.min(max, current * trackpadZoomFactor(deltaY, deltaMode)));
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

/** The window event the App's key handler sends to ask the canvas to zoom. */
export const CANVAS_ZOOM_EVENT = 'inflight:canvas-zoom';
export type CanvasZoomAction = 'in' | 'out' | 'fit' | 'actual';
export function isCanvasZoomAction(value: unknown): value is CanvasZoomAction {
  return value === 'in' || value === 'out' || value === 'fit' || value === 'actual';
}

/**
 * The zoom a key asks for, in the canvas's own units (1 = Fit), or null when there is nothing to do.
 * In and out step by the zoom bar's own 1.25, within the pinch's 0.25 to 8. "Actual" is 100%: one photo pixel per
 * screen pixel, and pressing it again at 100% goes back to Fit, as Lightroom's Z does. Without the photo's size, 100% is Fit.
 */
export function keyboardZoomTarget(action: CanvasZoomAction, current: number, fitScale: number | null, max = 8): number | null {
  const zoom = Number.isFinite(current) && current > 0 ? current : 1;
  const clampZoom = (value: number) => Math.max(0.25, Math.min(max, value));
  if (action === 'in') return clampZoom(zoom * 1.25);
  if (action === 'out') return clampZoom(zoom / 1.25);
  if (action === 'fit') return 1;
  if (!fitScale || !Number.isFinite(fitScale) || fitScale <= 0) return 1;
  const actual = 1 / fitScale;
  return Math.abs(zoom * fitScale - 1) <= 0.01 ? 1 : actual;
}

/**
 * Whether a wheel event is a mouse wheel's notch rather than a trackpad's smooth scroll. A notch comes in lines
 * (Firefox) or with the legacy wheel delta in whole steps of 120 and nothing sideways (Chromium, WebKit). A trackpad
 * scroll is pixels in small uneven steps, so it keeps scrolling the zoomed picture.
 */
export function isMouseWheelNotch(event: { deltaX: number; deltaY: number; deltaMode: number; wheelDeltaY?: number }): boolean {
  if (!Number.isFinite(event.deltaY) || event.deltaY === 0 || event.deltaX !== 0) return false;
  if (event.deltaMode === 1 || event.deltaMode === 2) return true;
  const legacy = event.wheelDeltaY;
  return typeof legacy === 'number' && legacy !== 0 && Number.isInteger(legacy) && legacy % 120 === 0;
}

/** One mouse-wheel notch: the zoom bar's own 1.25 step, in or out, within the pinch's 0.25 to 8. */
export function mouseWheelZoom(current: number, deltaY: number, max = 8): number {
  const zoom = Number.isFinite(current) && current > 0 ? current : 1;
  if (!Number.isFinite(deltaY) || deltaY === 0) return zoom;
  return Math.max(0.25, Math.min(max, deltaY < 0 ? zoom * 1.25 : zoom / 1.25));
}

/**
 * The most "Zoom to eye/subject" may magnify, in the canvas's own units (1 = Fit). It is one picture pixel for each
 * screen pixel the display really has, so 50% of the photo on a 2× screen and 100% on a 1× screen: past that the extra
 * magnification shows nothing the screen can use. Never past 100% of the photo's own pixels (only the 100% control goes
 * there, by name), and never below Fit. Without the photo's size: 2×, as before.
 */
export function focusZoomCeiling(fitScale: number | null, devicePixelRatio = 1): number {
  if (!fitScale || !Number.isFinite(fitScale) || fitScale <= 0) return 2;
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio >= 1 ? devicePixelRatio : 1;
  return Math.max(1, Math.min(1 / fitScale, 1 / (fitScale * ratio)));
}

/**
 * The zoom that keeps the same share of the photo's pixels on screen when Fit changes under it: a photo's true size can
 * arrive after the 100% zoom was chosen (the first size is the preview's), and the same canvas zoom would then read as
 * 20%, not 100%. Returns the canvas zoom for the same percentage at the new Fit.
 */
export function rebaseZoomForFit(zoom: number, oldFit: number, newFit: number): number {
  if (![zoom, oldFit, newFit].every((v) => Number.isFinite(v) && v > 0)) return zoom;
  return Math.max(0.25, zoom * (oldFit / newFit));
}
