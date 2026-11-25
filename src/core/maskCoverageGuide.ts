import { effectiveAlpha } from './masks';
import type { Mask } from './maskTypes';

/** Diagonal hatching: the coverage reads as a pattern, not only as a colour tint (no colour-only cues). */
export const HATCH_PERIOD = 8;
export const HATCH_STRIPE = 3;
export const HATCH_ALPHA = 210;
export const TINT_ALPHA = 90;

export function isHatchStripe(x: number, y: number): boolean {
  return (x + y) % HATCH_PERIOD < HATCH_STRIPE;
}

/** A bounded, translucent view of the actual local adjustment weights. Independent of slider values:
 * an unedited new mask still shows where it will apply. Hidden/missing masks show no guide.
 * Stronger diagonal stripes over a lighter tint, both scaled by the real weight, so the pattern fades with the effect. */
/** How the guide shows the mask: a line round where it applies (the default), or the hatched area. */
export type MaskGuideStyle = 'outline' | 'fill';

export function maskCoverageGuide(masks: readonly Mask[], maskId: string, sourceWidth: number, sourceHeight: number, style: MaskGuideStyle = 'fill') {
  const mask = masks.find(item => item.id === maskId && !item.hidden);
  if (!mask || !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return null;
  const scale = Math.min(1, 384 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const weights = effectiveAlpha(mask, masks, width, height, { aspect: sourceHeight / sourceWidth, view: { x: 0, y: 0, w: 1, h: 1 } });
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (style === 'outline') return { width, height, rgba: outlineRgba(weights, width, height, rgba) };
  for (let i = 0; i < weights.length; i++) {
    const stripe = isHatchStripe(i % width, Math.floor(i / width));
    if (stripe) { rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255; } else { rgba[i * 4] = 245; rgba[i * 4 + 1] = 62; rgba[i * 4 + 2] = 160; }
    rgba[i * 4 + 3] = Math.round(weights[i] * (stripe ? HATCH_ALPHA : TINT_ALPHA));
  }
  return { width, height, rgba };
}

/** Where the mask is at least half strength. */
const OUTLINE_THRESHOLD = 0.5;

/**
 * A line round the mask: a white core on the mask's edge with a dark ring just outside it, so the line reads on light
 * and dark photographs alike and the picture inside stays untouched. Shape, not colour, carries the meaning.
 */
function outlineRgba(weights: Float32Array, width: number, height: number, rgba: Uint8ClampedArray): Uint8ClampedArray {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && weights[y * width + x] >= OUTLINE_THRESHOLD;
  const edge = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inside(x, y) && (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1))) edge[y * width + x] = 1;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (edge[i]) { rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255; continue; }
      if (inside(x, y)) continue;
      const nearEdge = (x > 0 && edge[i - 1]) || (x < width - 1 && edge[i + 1]) || (y > 0 && edge[i - width]) || (y < height - 1 && edge[i + width]);
      if (nearEdge) { rgba[i * 4 + 3] = 220; } // black ring (rgb stays 0)
    }
  }
  return rgba;
}
