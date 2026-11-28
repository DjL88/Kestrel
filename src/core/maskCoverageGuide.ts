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
/** The hatched area is drawn at most this size; the outline finer, so its line stays smooth when the picture is shown large. */
export const FILL_EDGE = 384;
export const OUTLINE_EDGE = 1024;

/** How the guide shows the mask: a line round where it applies (the default), or the hatched area. */
export type MaskGuideStyle = 'outline' | 'fill';

/** The longest edge the outline is ever drawn at (about 2K: finer is invisible, and costs memory and time). */
export const OUTLINE_EDGE_MAX = 2048;

/**
 * How many guide pixels the outline needs for a picture shown this many screen pixels along its long edge: as many as
 * are shown (so the line is a few screen pixels wide at every zoom, never a coarse raster stretched), in steps of 512 so
 * a zoom does not redraw it at every step, from OUTLINE_EDGE to OUTLINE_EDGE_MAX. The hatched fill is a pattern and stays small.
 */
export function guideEdgeFor(shownEdge: number, style: MaskGuideStyle): number {
  if (style === 'fill') return FILL_EDGE;
  if (!Number.isFinite(shownEdge) || shownEdge <= OUTLINE_EDGE) return OUTLINE_EDGE;
  return Math.min(OUTLINE_EDGE_MAX, Math.ceil(shownEdge / 512) * 512);
}

export function maskCoverageGuide(masks: readonly Mask[], maskId: string, sourceWidth: number, sourceHeight: number, style: MaskGuideStyle = 'fill', edge?: number, brightness?: (width: number, height: number) => Float32Array | undefined) {
  const mask = masks.find(item => item.id === maskId && !item.hidden);
  if (!mask || !Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return null;
  const wanted = edge && Number.isFinite(edge) && edge > 0 ? Math.min(edge, OUTLINE_EDGE_MAX) : style === 'outline' ? OUTLINE_EDGE : FILL_EDGE;
  const scale = Math.min(1, wanted / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const weights = effectiveAlpha(mask, masks, width, height, { aspect: sourceHeight / sourceWidth, view: { x: 0, y: 0, w: 1, h: 1 }, luma: brightness?.(width, height) });
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (style === 'outline') return { width, height, rgba: outlineRgba(weights, width, height, rgba) };
  for (let i = 0; i < weights.length; i++) {
    const stripe = isHatchStripe(i % width, Math.floor(i / width));
    if (stripe) { rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255; } else { rgba[i * 4] = 245; rgba[i * 4 + 1] = 62; rgba[i * 4 + 2] = 160; }
    rgba[i * 4 + 3] = Math.round(weights[i] * (stripe ? HATCH_ALPHA : TINT_ALPHA));
  }
  return { width, height, rgba };
}

/** The line follows where the mask is at half strength. */
const OUTLINE_THRESHOLD = 0.5;
/** Half the white line's width, and how far outside it the dark ring sits, in guide pixels. */
const LINE_HALF = 1;
const RING_CENTRE = 2;
const RING_ALPHA = 220;

/**
 * A line round the mask: a white core on the mask's edge with a dark ring just outside it, so the line reads on light
 * and dark photographs alike and the picture inside stays untouched. Shape, not colour, carries the meaning.
 *
 * Each pixel's distance to the half-strength edge comes from the weight and its slope there, so the line falls between
 * pixels where the edge does and is drawn with soft sides: a smooth curve, not a staircase of whole pixels.
 */
function outlineRgba(weights: Float32Array, width: number, height: number, rgba: Uint8ClampedArray): Uint8ClampedArray {
  // A light blur first (two 3 x 3 passes; the half-strength edge stays where it is), so a hard-edged mask (a brush, an
  // oval with no feather) has a slope to measure on both sides of its edge too.
  const soft = boxBlur3(boxBlur3(weights, width, height), width, height);
  const at = (x: number, y: number) => soft[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = (at(x + 1, y) - at(x - 1, y)) / 2;
      const gy = (at(x, y + 1) - at(x, y - 1)) / 2;
      const slope = Math.hypot(gx, gy);
      if (slope < 1e-4) continue;
      // Signed distance to the edge in pixels: positive inside, negative outside.
      const d = (at(x, y) - OUTLINE_THRESHOLD) / slope;
      if (d > LINE_HALF + 0.5 || d < -(RING_CENTRE + LINE_HALF + 0.5)) continue;
      const white = clamp01(LINE_HALF + 0.5 - Math.abs(d));
      // The ring fills everything just outside the line, fading out at its outer side; the white line is laid over it.
      const dark = d < 0 ? clamp01(RING_CENTRE + LINE_HALF + 0.5 + d) * (RING_ALPHA / 255) : 0;
      const alpha = white + dark * (1 - white);
      if (alpha <= 0) continue;
      const i = (y * width + x) * 4;
      const grey = Math.round((255 * white) / alpha);
      rgba[i] = grey; rgba[i + 1] = grey; rgba[i + 2] = grey; rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

function boxBlur3(values: Float32Array, width: number, height: number): Float32Array {
  const across = new Float32Array(values.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const row = y * width;
    across[row + x] = (values[row + Math.max(0, x - 1)] + values[row + x] + values[row + Math.min(width - 1, x + 1)]) / 3;
  }
  const out = new Float32Array(values.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    out[y * width + x] = (across[Math.max(0, y - 1) * width + x] + across[y * width + x] + across[Math.min(height - 1, y + 1) * width + x]) / 3;
  }
  return out;
}
