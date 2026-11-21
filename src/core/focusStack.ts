/**
 * Focus stacking: merge frames shot at different focus distances into one image that is sharp throughout.
 *
 * Pure and platform-free (no DOM, no canvas), so it runs unchanged in a worker, on the desktop and on a phone, and is
 * unit-tested on synthetic frames. Every output pixel is a blend of real source pixels (nothing is generated).
 *
 * Steps:
 *  1. Align every frame to the middle frame: translation plus a small scale and rotation, coarse to fine on a
 *     high-pass copy of the luminance, chaining neighbouring frames so large focus differences do not confuse it.
 *     If the match is weak or ambiguous the stack is REFUSED, calmly, and nothing is changed.
 *  2. Measure sharpness per pixel (smoothed Laplacian of luminance).
 *  3. Fuse in a Laplacian pyramid, taking at each pixel and band the frame with the most local detail, which avoids
 *     the halos that picking whole pixels would leave. Arithmetic is in floating point, so 16-bit sources stay 16-bit.
 *  4. Bounded memory: the fusion works in horizontal bands with an overlap margin, sized to `maxWorkingBytes`.
 */

export type PixelData = Uint8ClampedArray | Uint8Array | Uint16Array | Float32Array;

/** One decoded frame: interleaved RGBA. Uint8 is 0 to 255, Uint16 is 0 to 65535, Float32 is 0 to 1. */
export interface StackFrame {
  width: number;
  height: number;
  data: PixelData;
}

export type StackRefusalReason = 'too-few' | 'size-mismatch' | 'unrelated' | 'ambiguous' | 'too-flat';

export interface StackWarning {
  code: 'equally-sharp' | 'frame-unused' | 'one-frame-dominates';
  message: string;
  frameIndex?: number;
}

export interface StackOptions {
  /** Bytes the fusion may use beyond the source frames. Default 256 MB. */
  maxWorkingBytes?: number;
  /** Pyramid levels (default 5). */
  levels?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, stage: 'aligning' | 'fusing') => void;
}

export interface StackSuccess {
  ok: true;
  width: number;
  height: number;
  /** Interleaved RGBA in the same type as the sources. */
  data: PixelData;
  /** Bits of precision kept: 8, 16 or 32. */
  bitDepth: 8 | 16 | 32;
  /** Share of the picture (0 to 1) each input frame supplied the finest detail for, in input order. */
  contribution: number[];
  /** Alignment found for each frame (0 for the reference): shift in pixels, scale and rotation in degrees. */
  alignment: { dx: number; dy: number; scale: number; rotationDegrees: number; score: number }[];
  referenceIndex: number;
  bands: number;
  warnings: StackWarning[];
}

export interface StackRefusal {
  ok: false;
  reason: StackRefusalReason;
  /** Plain English, calm, says what was kept and what to try. */
  message: string;
  frameIndex?: number;
}

export type StackResult = StackSuccess | StackRefusal;

export class StackCancelledError extends Error {
  constructor() { super('Stacking was stopped.'); this.name = 'StackCancelledError'; }
}

const KEPT = ' Your original photos are untouched.';

export const refusalMessages = {
  tooFew: 'Choose at least two photos to stack.' + KEPT,
  sizeMismatch: 'These photos are different sizes, so they cannot be lined up.' + KEPT,
  unrelated: (n: number) => `Photo ${n} does not look like the same scene as its neighbour, so Kite44 did not stack them. Choose frames from one burst.` + KEPT,
  ambiguous: (n: number) => `Kite44 cannot tell how photo ${n} lines up with its neighbour (the pattern repeats or there is too little detail). It did not guess.` + KEPT,
  tooFlat: (n: number) => `Photo ${n} has too little detail to line up. It did not guess.` + KEPT,
};

// ---------------------------------------------------------------------------------------------------------------------
// Small image helpers (single-plane Float32)
// ---------------------------------------------------------------------------------------------------------------------

interface Plane { w: number; h: number; d: Float32Array }

function depthOf(data: PixelData): { max: number; bits: 8 | 16 | 32 } {
  if (data instanceof Uint16Array) return { max: 65535, bits: 16 };
  if (data instanceof Float32Array) return { max: 1, bits: 32 };
  return { max: 255, bits: 8 };
}

function luminancePlane(frame: StackFrame): Plane {
  const { w, h } = { w: frame.width, h: frame.height };
  const { max } = depthOf(frame.data);
  const out = new Float32Array(w * h);
  const k = 1 / max;
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (0.2126 * frame.data[p] + 0.7152 * frame.data[p + 1] + 0.0722 * frame.data[p + 2]) * k;
  }
  return { w, h, d: out };
}

/** Mean of 2x2 blocks. */
function halve(src: Plane): Plane {
  const w = Math.max(1, src.w >> 1), h = Math.max(1, src.h >> 1);
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.min(src.h - 1, y * 2), y1 = Math.min(src.h - 1, y * 2 + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(src.w - 1, x * 2), x1 = Math.min(src.w - 1, x * 2 + 1);
      d[y * w + x] = (src.d[y0 * src.w + x0] + src.d[y0 * src.w + x1] + src.d[y1 * src.w + x0] + src.d[y1 * src.w + x1]) / 4;
    }
  }
  return { w, h, d };
}

/** Separable box blur with clamped edges, using running sums. */
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const n = 2 * radius + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / n;
      sum += src[row + Math.min(w - 1, x + radius + 1)] - src[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / n;
      sum += tmp[Math.min(h - 1, y + radius + 1) * w + x] - tmp[Math.max(0, y - radius) * w + x];
    }
  }
  return out;
}

/** A band-passed copy, so alignment follows detail and ignores brightness drift and soft blur differences. */
function highPass(p: Plane): { norm: Plane; weight: Plane } {
  const blurred = boxBlur(p.d, p.w, p.h, 2);
  const d = new Float32Array(p.d.length);
  for (let i = 0; i < d.length; i++) d[i] = p.d[i] - blurred[i];
  // Local contrast normalisation: a region that is out of focus in one frame still counts, so frames that are each
  // sharp in a different part can be matched. Flat regions (below the floor) stay quiet instead of being amplified.
  const squares = d.map((v) => v * v);
  const energy = boxBlur(squares, p.w, p.h, 6);
  const weight = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) { const e = Math.sqrt(energy[i]); weight[i] = e; d[i] = d[i] / (e + 0.004); }
  return { norm: { w: p.w, h: p.h, d }, weight: { w: p.w, h: p.h, d: weight } };
}

function sample(p: Float32Array, w: number, h: number, u: number, v: number): number {
  const x0 = Math.floor(u), y0 = Math.floor(v);
  const fx = u - x0, fy = v - y0;
  const xa = Math.min(w - 1, Math.max(0, x0)), xb = Math.min(w - 1, Math.max(0, x0 + 1));
  const ya = Math.min(h - 1, Math.max(0, y0)), yb = Math.min(h - 1, Math.max(0, y0 + 1));
  const top = p[ya * w + xa] * (1 - fx) + p[ya * w + xb] * fx;
  const bottom = p[yb * w + xa] * (1 - fx) + p[yb * w + xb] * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * The Laplacian magnitude of luminance, smoothed: how much real detail is around each pixel. Exported because it is the
 * measure the stacking decisions and the "these frames are equally sharp" check are built on.
 */
export function sharpnessMap(lum: Float32Array, w: number, h: number, smoothRadius = 2): Float32Array {
  const lap = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1), yp = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(w - 1, x + 1);
      lap[y * w + x] = Math.abs(4 * lum[y * w + x] - lum[y * w + xm] - lum[y * w + xp] - lum[ym * w + x] - lum[yp * w + x]);
    }
  }
  return boxBlur(lap, w, h, smoothRadius);
}

// ---------------------------------------------------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------------------------------------------------

/** Maps coordinates of the reference frame to coordinates of the frame being placed: u = a x + b y + tx, v = c x + d y + ty. */
export interface Affine { a: number; b: number; c: number; d: number; tx: number; ty: number }

const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

function compose(p: Affine, m: Affine): Affine {
  return {
    a: p.a * m.a + p.b * m.c, b: p.a * m.b + p.b * m.d,
    c: p.c * m.a + p.d * m.c, d: p.c * m.b + p.d * m.d,
    tx: p.a * m.tx + p.b * m.ty + p.tx, ty: p.c * m.tx + p.d * m.ty + p.ty,
  };
}

interface Similarity { s: number; th: number; tx: number; ty: number }

function toAffine(p: Similarity, cx: number, cy: number): Affine {
  const a = p.s * Math.cos(p.th), c = p.s * Math.sin(p.th);
  return { a, b: -c, c, d: a, tx: cx + p.tx - (a * cx - c * cy), ty: cy + p.ty - (c * cx + a * cy) };
}

const ALIGN_SIZE = 512;
const COARSE_LEVELS = 4; // levels above the finest (finest ~512 px, coarsest ~64 px)
const MIN_COARSE_SCORE = 0.3;
const MIN_FINAL_SCORE = 0.4;
const AMBIGUITY_RATIO = 0.93;
const MIN_DETAIL = 1e-3;

/** `levels` are locally normalised high-pass planes; `weights` is how much real detail each pixel has (0 where blurred). */
interface AlignPyramid { levels: Plane[]; weights: Plane[]; fx: number[]; fy: number[] }

function alignPyramid(lum: Plane): AlignPyramid {
  let base = lum;
  while (Math.max(base.w, base.h) > ALIGN_SIZE) base = halve(base);
  const first = highPass(base);
  const levels: Plane[] = [first.norm], weights: Plane[] = [first.weight];
  let low = base;
  for (let i = 0; i < COARSE_LEVELS && Math.min(low.w, low.h) >= 32; i++) {
    low = halve(low);
    const next = highPass(low);
    levels.push(next.norm); weights.push(next.weight);
  }
  return { levels, weights, fx: levels.map((l) => lum.w / l.w), fy: levels.map((l) => lum.h / l.h) };
}

/** Normalised cross-correlation of the reference and the transformed frame at one level, or -1 when they hardly overlap. */
function score(ref: AlignPyramid, frm: AlignPyramid, level: number, m: Affine): number {
  const a = ref.levels[level], b = frm.levels[level], ra = ref.weights[level], rb = frm.weights[level];
  const fx = ref.fx[level], fy = ref.fy[level];
  const step = Math.max(1, Math.round(Math.sqrt((a.w * a.h) / 60_000)));
  let n = 0, sw = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, total = 0;
  for (let y = 1; y < a.h - 1; y += step) {
    for (let x = 1; x < a.w - 1; x += step) {
      total++;
      const X = x * fx, Y = y * fy;
      const u = (m.a * X + m.b * Y + m.tx) / fx, v = (m.c * X + m.d * Y + m.ty) / fy;
      if (u < 1 || v < 1 || u > b.w - 2 || v > b.h - 2) continue;
      const va = a.d[y * a.w + x], vb = sample(b.d, b.w, b.h, u, v);
      // Count a pixel by the detail present in BOTH frames: where one is blurred it says little about alignment.
      const wt = Math.min(ra.d[y * a.w + x], sample(rb.d, b.w, b.h, u, v)) + 0.002;
      n++; sw += wt; sa += wt * va; sb += wt * vb; saa += wt * va * va; sbb += wt * vb * vb; sab += wt * va * vb;
    }
  }
  if (n < total * 0.4 || n < 16) return -1;
  const varA = saa - (sa * sa) / sw, varB = sbb - (sb * sb) / sw;
  if (varA < MIN_DETAIL * sw || varB < MIN_DETAIL * sw) return -1;
  return (sab - (sa * sb) / sw) / Math.sqrt(varA * varB);
}

type Registration =
  | { ok: true; affine: Affine; score: number }
  | { ok: false; reason: 'unrelated' | 'ambiguous' | 'too-flat' };

/** Where does a pixel of `ref` appear in `frm`? Coarse exhaustive shift search, then hill-climbing all four parameters. */
function register(ref: AlignPyramid, frm: AlignPyramid, width: number, height: number): Registration {
  const cx = width / 2, cy = height / 2;
  const top = ref.levels.length - 1;
  const fx = ref.fx[top], fy = ref.fy[top];
  const range = Math.ceil(ref.levels[top].w * 0.2);
  const grid: { dx: number; dy: number; v: number }[] = [];
  let best = { dx: 0, dy: 0, v: -2 };
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const v = score(ref, frm, top, toAffine({ s: 1, th: 0, tx: dx * fx, ty: dy * fy }, cx, cy));
      grid.push({ dx, dy, v });
      if (v > best.v) best = { dx, dy, v };
    }
  }
  if (best.v < 0) return { ok: false, reason: 'too-flat' };
  if (best.v < MIN_COARSE_SCORE) return { ok: false, reason: 'unrelated' };
  // A second, separate peak that is nearly as good means the pattern repeats: the match is a guess.
  let second = -2;
  for (const g of grid) if (Math.max(Math.abs(g.dx - best.dx), Math.abs(g.dy - best.dy)) > 2 && g.v > second) second = g.v;
  if (second > best.v * AMBIGUITY_RATIO) return { ok: false, reason: 'ambiguous' };

  const p: Similarity = { s: 1, th: 0, tx: best.dx * fx, ty: best.dy * fy };
  // Fine levels of two frames that are each blurred in a different place correlate poorly even when perfectly lined up,
  // so how well the match holds is the best any level reached, not the last.
  let last = best.v;
  for (let level = top; level >= 0; level--) {
    const f = ref.fx[level];
    let stepT = f, stepS = 0.004 * Math.min(8, f), stepR = 0.004 * Math.min(8, f);
    const minT = 0.12 * ref.fx[0];
    let current = score(ref, frm, level, toAffine(p, cx, cy));
    for (let iter = 0; iter < 80 && stepT > minT; iter++) {
      let moved = false;
      for (const [key, step] of [['tx', stepT], ['ty', stepT], ['s', stepS], ['th', stepR]] as const) {
        for (const sign of [1, -1]) {
          const trial = { ...p, [key]: p[key] + sign * step };
          const v = score(ref, frm, level, toAffine(trial, cx, cy));
          if (v > current + ((key === 's' || key === 'th') ? 0.01 : 1e-4)) { Object.assign(p, trial); current = v; moved = true; break; }
        }
      }
      if (!moved) { stepT /= 2; stepS /= 2; stepR /= 2; }
    }
    last = Math.max(last, current);
  }
  if (last < MIN_FINAL_SCORE) return { ok: false, reason: 'unrelated' };
  // Small corrections only: a large scale or rotation would be a different photograph, not breathing or a nudge.
  if (Math.abs(p.s - 1) > 0.06 || Math.abs(p.th) > 0.1) return { ok: false, reason: 'ambiguous' };
  return { ok: true, affine: toAffine(p, cx, cy), score: last };
}

// ---------------------------------------------------------------------------------------------------------------------
// Laplacian pyramid fusion
// ---------------------------------------------------------------------------------------------------------------------

const KERNEL = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];

function gaussDown(src: Float32Array, w: number, h: number): { d: Float32Array; w: number; h: number } {
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += KERNEL[k + 2] * src[y * w + Math.min(w - 1, Math.max(0, x + k))];
      tmp[y * w + x] = s;
    }
  }
  const nw = Math.max(1, (w + 1) >> 1), nh = Math.max(1, (h + 1) >> 1);
  const d = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += KERNEL[k + 2] * tmp[Math.min(h - 1, Math.max(0, y * 2 + k)) * w + Math.min(w - 1, x * 2)];
      d[y * nw + x] = s;
    }
  }
  return { d, w: nw, h: nh };
}

function upsample(src: Float32Array, sw: number, sh: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = sample(src, sw, sh, x / 2, y / 2);
  }
  return out;
}

interface Pyramid { w: number[]; h: number[]; bands: Float32Array[][]; /** per channel, per level; the last level is the low-pass residual */ }

function buildPyramid(rgb: Float32Array[], w: number, h: number, levels: number): Pyramid {
  const pyr: Pyramid = { w: [], h: [], bands: [[], [], []] };
  let cw = w, ch = h;
  let current = rgb;
  for (let level = 0; level < levels; level++) {
    pyr.w.push(cw); pyr.h.push(ch);
    const down = current.map((c) => gaussDown(c, cw, ch));
    for (let c = 0; c < 3; c++) {
      const up = upsample(down[c].d, down[c].w, down[c].h, cw, ch);
      const lap = new Float32Array(cw * ch);
      for (let i = 0; i < lap.length; i++) lap[i] = current[c][i] - up[i];
      pyr.bands[c].push(lap);
    }
    current = down.map((d) => d.d);
    cw = down[0].w; ch = down[0].h;
  }
  pyr.w.push(cw); pyr.h.push(ch);
  for (let c = 0; c < 3; c++) pyr.bands[c].push(current[c]);
  return pyr;
}

function collapse(pyr: Pyramid): Float32Array[] {
  const levels = pyr.w.length - 1;
  let current = pyr.bands.map((b) => b[levels]);
  for (let level = levels - 1; level >= 0; level--) {
    current = current.map((c, ch) => {
      const up = upsample(c, pyr.w[level + 1], pyr.h[level + 1], pyr.w[level], pyr.h[level]);
      const band = pyr.bands[ch][level];
      for (let i = 0; i < up.length; i++) up[i] += band[i];
      return up;
    });
  }
  return current;
}

function levelEnergy(pyr: Pyramid, level: number): Float32Array {
  const n = pyr.w[level] * pyr.h[level];
  const e = new Float32Array(n);
  const [r, g, b] = [pyr.bands[0][level], pyr.bands[1][level], pyr.bands[2][level]];
  for (let i = 0; i < n; i++) e[i] = Math.abs(0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i]);
  return boxBlur(e, pyr.w[level], pyr.h[level], level === 0 ? 2 : 1);
}

const SWITCH_MARGIN = 0.002; // a new frame must beat the current one by this much, so noise does not make speckle

/** Warp one band of rows (plus margin) of a frame into the reference geometry. Returns RGB planes and a validity mask. */
function warpBand(frame: StackFrame, m: Affine, y0: number, rows: number, max: number): { rgb: Float32Array[]; valid: Uint8Array } {
  const w = frame.width, h = frame.height;
  const n = w * rows;
  const rgb = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const valid = new Uint8Array(n);
  const k = 1 / max;
  const src = frame.data;
  for (let y = 0; y < rows; y++) {
    const Y = y0 + y;
    for (let x = 0; x < w; x++) {
      const u = m.a * x + m.b * Y + m.tx, v = m.c * x + m.d * Y + m.ty;
      const i = y * w + x;
      valid[i] = u >= 0 && v >= 0 && u <= w - 1 && v <= h - 1 ? 1 : 0;
      const cu = Math.min(w - 1, Math.max(0, u)), cv = Math.min(h - 1, Math.max(0, v));
      const x0 = Math.floor(cu), y0f = Math.floor(cv);
      const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0f + 1);
      const fx = cu - x0, fy = cv - y0f;
      const p00 = (y0f * w + x0) * 4, p10 = (y0f * w + x1) * 4, p01 = (y1 * w + x0) * 4, p11 = (y1 * w + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[p00 + c] * (1 - fx) + src[p10 + c] * fx;
        const bottom = src[p01 + c] * (1 - fx) + src[p11 + c] * fx;
        rgb[c][i] = (top * (1 - fy) + bottom * fy) * k;
      }
    }
  }
  return { rgb, valid };
}

function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw new StackCancelledError(); }

/** Let a worker (or the page) handle a stop message between heavy steps. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------------------------------------------------

/** Frames needed at once for a stack, for the interface to check before it starts. */
export function estimateStackBytes(width: number, height: number, frameCount: number): number {
  return frameCount * width * height * 4;
}

export async function stackFrames(frames: readonly StackFrame[], options: StackOptions = {}): Promise<StackResult> {
  const { signal, onProgress } = options;
  const levels = Math.max(2, Math.min(7, options.levels ?? 5));
  if (frames.length < 2) return { ok: false, reason: 'too-few', message: refusalMessages.tooFew };
  const { width, height } = frames[0];
  const kind = frames[0].data.constructor;
  if (frames.some((f) => f.width !== width || f.height !== height || f.data.length !== width * height * 4 || f.data.constructor !== kind)) {
    return { ok: false, reason: 'size-mismatch', message: refusalMessages.sizeMismatch };
  }
  const { max, bits } = depthOf(frames[0].data);
  const total = frames.length - 1 + frames.length; // alignments + fused frames
  let done = 0;
  const tick = (stage: 'aligning' | 'fusing') => { done++; onProgress?.(Math.min(done, total), total, stage); };

  // 1. Align: the middle frame is the reference; each other frame is matched to the neighbour nearer the reference.
  const reference = Math.floor((frames.length - 1) / 2);
  const pyramids: (AlignPyramid | null)[] = new Array(frames.length).fill(null);
  const lums: Plane[] = new Array(frames.length);
  const prepare = (i: number) => {
    if (!pyramids[i]) { lums[i] = luminancePlane(frames[i]); pyramids[i] = alignPyramid(lums[i]); }
    return pyramids[i]!;
  };
  const matrices: Affine[] = new Array(frames.length);
  const alignment: StackSuccess['alignment'] = new Array(frames.length);
  matrices[reference] = IDENTITY;
  alignment[reference] = { dx: 0, dy: 0, scale: 1, rotationDegrees: 0, score: 1 };
  const order: [number, number][] = [];
  for (let i = reference - 1; i >= 0; i--) order.push([i, i + 1]);
  for (let i = reference + 1; i < frames.length; i++) order.push([i, i - 1]);
  for (const [i, near] of order) {
    checkAbort(signal);
    await breathe();
    const result = register(prepare(near), prepare(i), width, height);
    if (!result.ok) {
      const n = i + 1;
      return { ok: false, reason: result.reason, frameIndex: i,
        message: result.reason === 'unrelated' ? refusalMessages.unrelated(n) : result.reason === 'too-flat' ? refusalMessages.tooFlat(n) : refusalMessages.ambiguous(n) };
    }
    // result.affine takes coordinates in `near` to coordinates in frame i; matrices[near] takes the reference to `near`.
    matrices[i] = compose(result.affine, matrices[near]);
    const m = matrices[i];
    alignment[i] = { dx: m.tx, dy: m.ty, scale: Math.hypot(m.a, m.c), rotationDegrees: (Math.atan2(m.c, m.a) * 180) / Math.PI, score: result.score };
    tick('aligning');
  }

  // Are the frames actually different in focus? If every frame is about as sharp everywhere, stacking cannot help.
  const warnings: StackWarning[] = [];
  {
    const maps = lums.map((lum) => sharpnessMap(lum.d, lum.w, lum.h, 2));
    const n = maps[0].length;
    let differing = 0;
    for (let p = 0; p < n; p++) {
      let hi = 0, lo = Infinity;
      for (const m of maps) { if (m[p] > hi) hi = m[p]; if (m[p] < lo) lo = m[p]; }
      if (hi > 0.004 && hi > lo * 1.5) differing++;
    }
    if (differing / n < 0.02) {
      warnings.push({ code: 'equally-sharp', message: 'These frames look equally sharp everywhere, so stacking may not improve the photo.' });
    }
  }

  // 2 and 3. Fuse in bands of rows with an overlap margin, one frame at a time.
  const margin = Math.min(height, 3 * 2 ** levels);
  const bytesPerRow = width * (4 + 4 + 4 + 2) * 4 * 1.4 * 3; // new + fused pyramids, energies and temporaries
  const maxWorking = options.maxWorkingBytes ?? 256 * 1024 * 1024;
  const coreRows = Math.max(16, Math.min(height, Math.floor(maxWorking / bytesPerRow) - 2 * margin));
  const bandCount = Math.ceil(height / coreRows);
  const out: PixelData = bits === 8 ? new Uint8ClampedArray(width * height * 4)
    : bits === 16 ? new Uint16Array(width * height * 4) : new Float32Array(width * height * 4);
  const picks = new Float64Array(frames.length);

  for (let band = 0; band < bandCount; band++) {
    const c0 = band * coreRows, c1 = Math.min(height, c0 + coreRows);
    const y0 = Math.max(0, c0 - margin), y1 = Math.min(height, c1 + margin), rows = y1 - y0;
    let fused: Pyramid | null = null;
    let energy: Float32Array[] = [];
    let finestChoice = new Int16Array(width * rows);
    const mean: Float32Array[][] = [];
    for (let i = 0; i < frames.length; i++) {
      checkAbort(signal);
      await breathe();
      const warped = warpBand(frames[i], matrices[i], y0, rows, max);
      const pyr = buildPyramid(warped.rgb, width, rows, levels);
      const energies = pyr.w.slice(0, levels).map((_, level) => {
        const e = levelEnergy(pyr, level);
        if (level === 0) for (let p = 0; p < e.length; p++) if (!warped.valid[p]) e[p] = -1;
        return e;
      });
      if (!fused) {
        fused = pyr; energy = energies;
        mean.push(...pyr.bands.map((b) => [b[levels].slice()]));
      } else {
        for (let level = 0; level < levels; level++) {
          const e = energies[level], best = energy[level];
          for (let p = 0; p < e.length; p++) {
            if (e[p] > best[p] + SWITCH_MARGIN || (best[p] < 0 && e[p] >= 0)) {
              best[p] = e[p];
              for (let c = 0; c < 3; c++) fused.bands[c][level][p] = pyr.bands[c][level][p];
              if (level === 0) finestChoice[p] = i;
            }
          }
        }
        for (let c = 0; c < 3; c++) {
          const resid = mean[c][0], add = pyr.bands[c][levels];
          for (let p = 0; p < resid.length; p++) resid[p] += add[p];
        }
      }
      tick('fusing');
    }
    // The residual is the mean of all frames' low-pass, so overall tone is steady.
    for (let c = 0; c < 3; c++) {
      const resid = mean[c][0];
      for (let p = 0; p < resid.length; p++) resid[p] /= frames.length;
      fused!.bands[c][levels] = resid;
    }
    const result = collapse(fused!);
    const skip = c0 - y0;
    for (let y = c0; y < c1; y++) {
      for (let x = 0; x < width; x++) {
        const src = (y - c0 + skip) * width + x, dst = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const v = Math.min(1, Math.max(0, result[c][src]));
          out[dst + c] = bits === 32 ? v : Math.round(v * max);
        }
        out[dst + 3] = bits === 32 ? 1 : max;
        const choice = finestChoice[src];
        picks[choice]++;
      }
    }
    finestChoice = new Int16Array(0);
  }

  const contribution = Array.from(picks, (n) => n / (width * height));
  contribution.forEach((share, i) => {
    if (share < 0.01) warnings.push({ code: 'frame-unused', frameIndex: i, message: `Photo ${i + 1} added almost nothing, so it barely changed the result.` });
  });
  if (Math.max(...contribution) > 0.95 && !warnings.some((w) => w.code === 'equally-sharp')) {
    warnings.push({ code: 'one-frame-dominates', message: 'One photo supplied almost all of the detail. Check that the frames were shot at different focus distances.' });
  }
  return { ok: true, width, height, data: out, bitDepth: bits, contribution, alignment, referenceIndex: reference, bands: bandCount, warnings };
}

