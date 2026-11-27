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
  /** The model's own soft edge (0..255, from its logits), so an outline follows the subject between mask pixels. */
  soft?: Uint8Array;
}

/**
 * A first tap with nothing else to go on means "this subject", not "this patch of it". The model offers several
 * candidates, from a small part to the whole object; it often rates the part highest (the white chest of a puffin). So
 * for that prompt the largest object the model rates nearly as well as its best is chosen, as long as it holds the
 * tapped point and is still an object (not most of the frame). Two candidates of nearly the same size are the same object,
 * one of them with a gap bridged (the notch under a puffin's beak and chin, owner's report 27 Nov): then the tighter one
 * is kept, so the outline follows the subject into its concave corners. Parts then come from more taps, and any other
 * prompt keeps the model's best.
 */
export const WHOLE_SUBJECT_SCORE_MARGIN = 0.12;
/** A candidate this much larger (by area) than another is a bigger object (part to whole), not the same one filled in. */
export const WHOLE_SUBJECT_GROWTH = 1.3;
export const WHOLE_SUBJECT_MIN_SCORE = 0.5;
export const WHOLE_SUBJECT_MAX_COVERAGE = 0.85;

/** Is this the first tap of a subject: one tap that adds, no box? */
export const isWholeSubjectPrompt = (prompt: SamPrompt) =>
  !prompt.box && (prompt.taps ?? []).length === 1 && Boolean(prompt.taps?.[0]?.add);
/** The tap of a first-tap prompt (see isWholeSubjectPrompt), else null. */
export const wholeSubjectTap = (prompt: SamPrompt): SamTap | null => isWholeSubjectPrompt(prompt) ? prompt.taps![0] : null;

/**
 * Pick one of the decoder's candidates and keep its soft edge. `masks` is [candidates, h, w]. `wholeSubjectAt` is the
 * tap of a first-tap prompt (wholeSubjectTap), in mask pixels; with null the model's best is taken.
 */
export function chooseSamMask(masks: Float32Array, scores: Float32Array, w: number, h: number, wholeSubjectAt: SamTap | null): SamMask {
  const plane = w * h;
  const candidates = scores.length;
  if (!candidates || masks.length !== candidates * plane) throw new Error('The selection model returned an unexpected result.');
  let best = 0;
  for (let i = 1; i < candidates; i += 1) if (scores[i] > scores[best]) best = i;
  const areas: number[] = [];
  for (let c = 0; c < candidates; c += 1) {
    let inside = 0;
    for (let i = 0; i < plane; i += 1) if (masks[c * plane + i] >= 0) inside += 1;
    areas.push(inside);
  }
  let chosen = best;
  if (wholeSubjectAt) {
    const tapped = Math.min(h - 1, Math.max(0, Math.floor(wholeSubjectAt.y))) * w + Math.min(w - 1, Math.max(0, Math.floor(wholeSubjectAt.x)));
    const holdsTap = (c: number) => masks[c * plane + tapped] >= 0;
    const object = (c: number) => holdsTap(c) && areas[c] / plane <= WHOLE_SUBJECT_MAX_COVERAGE;
    // The best-rated candidate that is an object at the tap, and every object rated nearly as well, smallest first.
    let reference = -1;
    for (let c = 0; c < candidates; c += 1) if (object(c) && (reference < 0 || scores[c] > scores[reference])) reference = c;
    if (reference >= 0) {
      const close = [...Array(candidates).keys()].filter((c) => c === reference || (object(c)
        && scores[c] >= scores[reference] - WHOLE_SUBJECT_SCORE_MARGIN && scores[c] >= WHOLE_SUBJECT_MIN_SCORE))
        .sort((a, b) => areas[a] - areas[b]);
      // Step up to a bigger object only; within the biggest object, keep its tightest candidate.
      chosen = close[0];
      for (const c of close.slice(1)) if (areas[c] >= areas[chosen] * WHOLE_SUBJECT_GROWTH) chosen = c;
    }
  }
  const data = new Uint8Array(plane);
  const soft = new Uint8Array(plane);
  for (let i = 0; i < plane; i += 1) {
    const v = masks[chosen * plane + i];
    if (v >= 0) data[i] = 1;
    soft[i] = Math.round(255 / (1 + Math.exp(-v)));
  }
  const score = Number.isFinite(scores[chosen]) ? Math.max(0, Math.min(1, scores[chosen])) : 0;
  return { w, h, data, score, coverage: areas[chosen] / plane, soft };
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
