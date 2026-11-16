/**
 * Zoom for looking at a photo's pixels. The viewport's own zoom is relative to the "fit to screen" view, so a 45-megapixel
 * photo fitted into a small window is already far below 100%. These helpers translate between that and what a
 * photographer means: 100% is one photo pixel for each screen pixel (device pixel on a high-density display).
 */
/** The most a photo can be zoomed in, as a share of its actual pixels (400%). */
export const MAX_ACTUAL_PERCENT = 400;
const OLD_MAX = 6;

/** How far past "fit" the viewport may zoom: at least what it always could, and up to 400% of actual pixels. */
export function maxZoomFor(fit: number, deviceRatio: number): number {
  if (!(fit > 0) || !(deviceRatio > 0)) return OLD_MAX;
  return Math.max(OLD_MAX, (MAX_ACTUAL_PERCENT / 100) / (fit * deviceRatio));
}

/** The viewport zoom that shows this share of the photo's actual pixels. */
export const zoomForPercent = (percent: number, fit: number, deviceRatio: number) => (percent / 100) / (fit * deviceRatio);

/** What share of actual pixels the current zoom shows, as a whole number. */
export const percentFor = (zoom: number, fit: number, deviceRatio: number) => Math.round(zoom * fit * deviceRatio * 100);

/** One step in or out: by half again, never past fit or the most allowed. */
export function stepZoom(zoom: number, direction: 1 | -1, maxZoom: number): number {
  const next = direction === 1 ? zoom * 1.5 : zoom / 1.5;
  return Math.max(1, Math.min(maxZoom, next < 1.02 ? 1 : next));
}
