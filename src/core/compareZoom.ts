import { maxZoomFor, zoomForPercent } from './zoomControls';

/**
 * A truthful 100% or 200% zoom for the pixels currently available in a preview.
 * Returns null when there is no decoded photo or Fit already exceeds the requested zoom.
 * Never claim to expose RAW sensor pixels from a downscaled embedded preview.
 */
export function comparePreviewPixelZoom(fit: number, deviceRatio: number, percent: 100 | 200 = 200): number | null {
  if (!Number.isFinite(fit) || !Number.isFinite(deviceRatio) || fit <= 0 || deviceRatio <= 0) return null;
  const requested = zoomForPercent(percent, fit, deviceRatio);
  if (!Number.isFinite(requested) || requested < 1) return null;
  return Math.min(maxZoomFor(fit, deviceRatio), requested);
}
