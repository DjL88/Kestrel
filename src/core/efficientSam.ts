/**
 * EfficientSAM-Ti (Xiong et al., Apache-2.0): tap-to-select masks. The encoder reads the photo once at 1024 x 1024
 * (RGB 0..1, planar; it normalises internally) and gives an embedding. The decoder then turns taps into a mask in
 * well under a second, so adding or removing parts never re-reads the photo. Taps are in mask pixels: positive taps
 * add, negative taps remove, and a box is two corner points. The model reads at most 6 points per subject. Several
 * subjects are several prompts against the same embedding.
 */

export const SAM_INPUT = 1024;
/** The decoder reads at most this many points per subject (the authors' `decoder_max_num_input_points`). */
export const SAM_MAX_POINTS = 6;
/** Masks come out at most this size on the long edge, never at full sensor resolution. */
export const SAM_MASK_EDGE = 1024;

export interface SamTap { x: number; y: number; /** true adds this part, false removes it. */ add: boolean }
export interface SamBox { x: number; y: number; w: number; h: number }
/** One subject: taps, a box, or both (box first, as the model was trained). */
export interface SamPrompt { taps?: readonly SamTap[]; box?: SamBox }

/** Planar 0..1 RGB from an RGBA picture already resized to 1024 x 1024. */
export function samInput(rgba: Uint8ClampedArray, size = SAM_INPUT): Float32Array {
  const plane = size * size;
  if (rgba.length < plane * 4) throw new RangeError('The picture is smaller than the model input.');
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) for (let c = 0; c < 3; c += 1) out[c * plane + i] = rgba[i * 4 + c] / 255;
  return out;
}

/** The mask size for a photo: its own shape, scaled so the long edge is at most SAM_MASK_EDGE. */
export function samMaskSize(width: number, height: number, edge = SAM_MASK_EDGE): { w: number; h: number } {
  if (!(width > 0 && height > 0)) throw new RangeError('The photo has no size.');
  const scale = Math.min(1, edge / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

/**
 * The decoder's points and labels for one subject (labels: 1 add, 0 remove, 2 and 3 box corners). Beyond six points
 * the box, the first added tap and the latest taps are kept, so the photographer's newest corrections always count.
 * Returns null when the prompt has nothing to go on (no box, no added tap).
 */
export function samPoints(prompt: SamPrompt): { coords: Float32Array; labels: Float32Array; count: number } | null {
  const pts: Array<[number, number, number]> = [];
  if (prompt.box) {
    const { x, y, w, h } = prompt.box;
    if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) pts.push([x, y, 2], [x + w, y + h, 3]);
  }
  const taps = (prompt.taps ?? []).filter((t) => Number.isFinite(t.x) && Number.isFinite(t.y));
  if (!pts.length && !taps.some((t) => t.add)) return null;
  const room = SAM_MAX_POINTS - pts.length;
  let kept = taps.slice(Math.max(0, taps.length - room));
  // Without a box, the subject needs at least one added tap: keep the first one in place of the oldest kept tap.
  if (!pts.length && !kept.some((t) => t.add)) kept = [taps.find((t) => t.add)!, ...kept.slice(1)];
  for (const t of kept) pts.push([t.x, t.y, t.add ? 1 : 0]);
  const coords = new Float32Array(pts.length * 2);
  const labels = new Float32Array(pts.length);
  pts.forEach(([x, y, l], i) => { coords[i * 2] = x; coords[i * 2 + 1] = y; labels[i] = l; });
  return { coords, labels, count: pts.length };
}

export interface SamMask {
  w: number;
  h: number;
  /** 1 inside the subject, 0 outside, row by row. */
  data: Uint8Array;
  /** The model's own estimate of mask quality (predicted IoU), 0..1. Not a measured accuracy. */
  score: number;
  /** Share of the frame covered. */
  coverage: number;
}

/** Pick the candidate the model rates best and threshold it at logit 0. `masks` is [candidates, h, w]. */
export function bestSamMask(masks: Float32Array, scores: Float32Array, w: number, h: number): SamMask {
  const plane = w * h;
  const candidates = scores.length;
  if (!candidates || masks.length !== candidates * plane) throw new Error('The selection model returned an unexpected result.');
  let best = 0;
  for (let i = 1; i < candidates; i += 1) if (scores[i] > scores[best]) best = i;
  const data = new Uint8Array(plane);
  let inside = 0;
  for (let i = 0; i < plane; i += 1) {
    const v = masks[best * plane + i];
    if (v >= 0) { data[i] = 1; inside += 1; }
  }
  const score = Number.isFinite(scores[best]) ? Math.max(0, Math.min(1, scores[best])) : 0;
  return { w, h, data, score, coverage: inside / plane };
}

/** Several subjects as one selection (union), for a single mask layer. Masks must share a size. */
export function unionSamMasks(masks: readonly SamMask[]): SamMask | null {
  if (!masks.length) return null;
  const { w, h } = masks[0];
  if (masks.some((m) => m.w !== w || m.h !== h)) throw new RangeError('Masks differ in size.');
  const data = new Uint8Array(w * h);
  let inside = 0;
  for (let i = 0; i < data.length; i += 1) if (masks.some((m) => m.data[i])) { data[i] = 1; inside += 1; }
  return { w, h, data, score: Math.min(...masks.map((m) => m.score)), coverage: inside / data.length };
}
