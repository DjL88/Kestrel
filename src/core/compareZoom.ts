import { maxZoomFor, zoomForPercent } from './zoomControls';

/**
 * A truthful 200% zoom for the pixels currently available in a preview.
 * Returns null when there is no decoded photo or Fit already exceeds 200%.
 * Never claim to expose RAW sensor pixels from a downscaled embedded preview.
 */
export function comparePreviewPixelZoom(fit: number, deviceRatio: number): number | null {
  if (!Number.isFinite(fit) || !Number.isFinite(deviceRatio) || fit <= 0 || deviceRatio <= 0) return null;
  const requested = zoomForPercent(200, fit, deviceRatio);
  if (!Number.isFinite(requested) || requested < 1) return null;
  return Math.min(maxZoomFor(fit, deviceRatio), requested);
}
