/**
 * Focus stacking: merge frames shot at different focus distances (a macro bracket, or a perched bird shot while the
 * focus ring moved) into one picture that is sharp throughout.
 *
 * Pure and platform-free (no DOM, no canvas), so it runs unchanged in a worker, on the desktop and on a phone, and is
 * unit-tested on synthetic focus brackets. NOTHING IS GENERATED: every output pixel is a weighted average (weights
 * 0 to 1 that add up to 1) of the same aligned place in the real source frames, so it always lies between the darkest
 * and brightest of them there. No pyramid band, sharpening or model invents detail.
 *
 * Steps:
 *  1. Global alignment of every frame to the middle frame: translation plus a small scale (focus breathing) and
 *     rotation, coarse to fine on a locally normalised high-pass copy of the luminance, chaining neighbouring frames
 *     so large focus differences do not confuse it. A weak or ambiguous match REFUSES the stack and changes nothing.
 *  2. Local alignment: a grid of small residual shifts measured tile by tile against the reference, kept only where
 *     both frames have real detail and the match is clear, filled from neighbouring tiles elsewhere, smoothed and
 *     capped. It catches what one global transform cannot (lens breathing that is not uniform, a slightly moving perch).
 *  3. A per-pixel sharpness map for each frame (smoothed Laplacian of luminance).
 *  4. A weight per frame from its sharpness (raised to a power, so the sharpest frame clearly wins), feathered by a
 *     blur so the transitions are soft, then the normalised blend of the real aligned pixels.
 *  5. Bounded memory: sources are read in horizontal bands (with a margin) through `StackSource.readRows`, so a stack of
 *     45-megapixel frames never needs every frame in memory at once.
 */

export type PixelData = Uint8ClampedArray | Uint8Array | Uint16Array | Float32Array;

/** One decoded frame: interleaved RGBA. Uint8 is 0 to 255, Uint16 is 0 to 65535, Float32 is 0 to 1. */
export interface StackFrame {
  width: number;
  height: number;
  data: PixelData;
}

/**
 * A frame read on demand: `readRows` returns interleaved RGBA rows `y0` to `y0 + rows - 1` (clamped by the caller to the
 * picture) in the frame's own sample type. The browser adapter draws them from a decoded image; tests wrap an array.
 */
export interface StackSource {
  width: number;
  height: number;
  /** 8 (0-255), 16 (0-65535) or 32 (float 0-1). */
  bits: 8 | 16 | 32;
  readRows(y0: number, rows: number): PixelData | Promise<PixelData>;
}

export type StackRefusalReason = 'too-few' | 'too-many' | 'size-mismatch' | 'unrelated' | 'ambiguous' | 'too-flat';

export interface StackWarning {
  code: 'equally-sharp' | 'frame-unused' | 'one-frame-dominates' | 'local-fallback';
  frameIndex?: number;
}

export interface StackOptions {
  /** Bytes the blending may use for one band of rows beyond the output. Default 192 MB. */
  maxWorkingBytes?: number;
  /** Longest edge of the luminance copy used to line frames up. Default 1024. */
  alignEdge?: number;
  /** Turn off the local refinement (tests compare with and without). */
  localAlign?: boolean;
  /** Sharpness power: higher picks the sharpest frame more decisively. Default 4. */
  power?: number;
  /** Feather radius in pixels of the weights (soft transitions). Default scales with the picture, at least 3. */
  feather?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, stage: StackStage) => void;
}

export type StackStage = 'reading' | 'aligning' | 'blending';

/** Where each frame was placed, for the recipe: maps reference pixel (x, y) to frame pixel (a x + b y + tx, c x + d y + ty). */
export interface FrameAlignment {
  dx: number; dy: number; scale: number; rotationDegrees: number;
  /** How well the global match held, 0 to 1. */
  score: number;
  /** Local refinement: tiles that matched clearly / all tiles, and the largest residual shift in pixels. */
  localTiles: { matched: number; total: number; maxShift: number };
}

export interface StackSuccess {
  ok: true;
  width: number;
  height: number;
  /** Interleaved RGBA, 16-bit (0 to 65535): a weighted average keeps more than 8 bits even from 8-bit frames. */
  data: Uint16Array;
  /** Bits of precision the sources carried (8, 16 or 32). The output is never claimed to hold more than they did. */
  sourceBits: 8 | 16 | 32;
  /** Share of the picture (0 to 1) where each input frame had the most weight, in input order. */
  contribution: number[];
  alignment: FrameAlignment[];
  /** The affine per frame, for the recipe and for a re-render. */
  affines: Affine[];
  referenceIndex: number;
  bands: number;
  warnings: StackWarning[];
  settings: { power: number; feather: number; alignEdge: number; localAlign: boolean };
}

export interface StackRefusal {
  ok: false;
  reason: StackRefusalReason;
  /** The 1-based photo the refusal is about, when there is one. */
  frameNumber?: number;
}

export type StackResult = StackSuccess | StackRefusal;

export class StackCancelledError extends Error {
  constructor() { super('Stacking was stopped.'); this.name = 'StackCancelledError'; }
}

export const MIN_STACK_FRAMES = 2;
export const MAX_STACK_FRAMES = 30;

// ---------------------------------------------------------------------------------------------------------------------
// Small image helpers (single-plane Float32)
// ---------------------------------------------------------------------------------------------------------------------

interface Plane { w: number; h: number; d: Float32Array }

const maxOf = (bits: 8 | 16 | 32) => (bits === 16 ? 65535 : bits === 32 ? 1 : 255);

export function bitsOf(data: PixelData): 8 | 16 | 32 {
  if (data instanceof Uint16Array) return 16;
  if (data instanceof Float32Array) return 32;
  return 8;
}

/** Wrap a decoded frame as a source. */
export function frameSource(frame: StackFrame): StackSource {
  const stride = frame.width * 4;
  return {
    width: frame.width, height: frame.height, bits: bitsOf(frame.data),
    readRows: (y0, rows) => frame.data.subarray(y0 * stride, (y0 + rows) * stride) as PixelData,
  };
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

/** |Laplacian| of luminance, before smoothing. */
function laplacianMagnitude(lum: Float32Array, w: number, h: number): Float32Array {
  const lap = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1), yp = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(w - 1, x + 1);
      lap[y * w + x] = Math.abs(4 * lum[y * w + x] - lum[y * w + xm] - lum[y * w + xp] - lum[ym * w + x] - lum[yp * w + x]);
    }
  }
  return lap;
}

/**
 * The Laplacian magnitude of luminance, smoothed: how much real detail is around each pixel. Exported because it is the
 * measure the stacking decisions, the proofs and the "these frames are equally sharp" check are built on.
 */
export function sharpnessMap(lum: Float32Array, w: number, h: number, smoothRadius = 2): Float32Array {
  return boxBlur(laplacianMagnitude(lum, w, h), w, h, smoothRadius);
}

/** Mean |Laplacian| of an RGBA picture's luminance, away from a border: one number for "how sharp is this". */
export function meanSharpness(width: number, height: number, data: PixelData, border = 4): number {
  const max = maxOf(bitsOf(data));
  const lum = new Float32Array(width * height);
  for (let i = 0; i < lum.length; i++) lum[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / max;
  const lap = laplacianMagnitude(lum, width, height);
  let sum = 0, n = 0;
  for (let y = border; y < height - border; y++) for (let x = border; x < width - border; x++) { sum += lap[y * width + x]; n++; }
  return n ? sum / n : 0;
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

/** Area-averaged luminance at most `maxEdge` on its longest side, read band by band. `factor` full pixels per plane pixel. */
async function luminanceOf(source: StackSource, maxEdge: number, signal?: AbortSignal): Promise<{ plane: Plane; factor: number }> {
  const factor = Math.max(1, Math.ceil(Math.max(source.width, source.height) / maxEdge));
  const w = Math.max(1, Math.floor(source.width / factor)), h = Math.max(1, Math.floor(source.height / factor));
  const d = new Float32Array(w * h);
  const k = 1 / (maxOf(source.bits) * factor * factor);
  const rowsPerRead = factor * Math.max(1, Math.floor(256 / factor));
  for (let y0 = 0; y0 < h * factor; y0 += rowsPerRead) {
    checkAbort(signal);
    const rows = Math.min(rowsPerRead, h * factor - y0);
    const px = await source.readRows(y0, rows);
    for (let r = 0; r < rows; r++) {
      const py = Math.floor((y0 + r) / factor), row = r * source.width * 4;
      for (let x = 0; x < w * factor; x++) {
        const p = row + x * 4;
        d[py * w + Math.floor(x / factor)] += (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) * k;
      }
    }
  }
  return { plane: { w, h, d }, factor };
}

/** An affine measured on a plane (`factor` full pixels per plane pixel, centres at f x + (f - 1) / 2) at full size. */
function affineToFull(m: Affine, f: number): Affine {
  const c = (f - 1) / 2;
  return { a: m.a, b: m.b, c: m.c, d: m.d, tx: f * m.tx + c - (m.a * c + m.b * c), ty: f * m.ty + c - (m.c * c + m.d * c) };
}

/** Residual shifts on a coarse grid (plane units) and a lookup at full size. */
interface ShiftField { cols: number; rows: number; cellW: number; cellH: number; du: Float32Array; dv: Float32Array; factor: number }

const TILE_TARGET = 8; // tiles across the longest side
const LOCAL_RANGE = 3; // plane pixels searched each way
const LOCAL_MIN_SCORE = 0.6;
const LOCAL_MIN_DETAIL = 0.01;

function warpPlane(p: Plane, m: Affine): Plane {
  const d = new Float32Array(p.w * p.h);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) d[y * p.w + x] = sample(p.d, p.w, p.h, m.a * x + m.b * y + m.tx, m.c * x + m.d * y + m.ty);
  return { w: p.w, h: p.h, d };
}

/** Measure the local residual of `frm` (already warped by the global transform) against `ref`, tile by tile. */
function localField(ref: Plane, warped: Plane, factor: number): { field: ShiftField; matched: number; total: number; maxShift: number } {
  const a = highPass(ref), b = highPass(warped);
  const cols = Math.max(1, Math.round((TILE_TARGET * ref.w) / Math.max(ref.w, ref.h)));
  const rows = Math.max(1, Math.round((TILE_TARGET * ref.h) / Math.max(ref.w, ref.h)));
  const cellW = ref.w / cols, cellH = ref.h / rows;
  const du = new Float32Array(cols * rows), dv = new Float32Array(cols * rows), ok = new Uint8Array(cols * rows);
  const R = LOCAL_RANGE;
  let matched = 0;
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const x0 = Math.max(R + 1, Math.floor(tx * cellW)), x1 = Math.min(ref.w - R - 1, Math.floor((tx + 1) * cellW));
      const y0 = Math.max(R + 1, Math.floor(ty * cellH)), y1 = Math.min(ref.h - R - 1, Math.floor((ty + 1) * cellH));
      if (x1 - x0 < 8 || y1 - y0 < 8) continue;
      // Real detail in both frames here? A tile blurred in either one says nothing about where it is.
      let da = 0, db = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { da += a.weight.d[y * ref.w + x]; db += b.weight.d[y * ref.w + x]; n++; }
      if (da / n < LOCAL_MIN_DETAIL || db / n < LOCAL_MIN_DETAIL) continue;
      const scores = new Float32Array((2 * R + 1) ** 2);
      let best = -2, bi = 0, bj = 0;
      for (let j = -R; j <= R; j++) {
        for (let i = -R; i <= R; i++) {
          let sab = 0, saa = 0, sbb = 0;
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const va = a.norm.d[y * ref.w + x], vb = b.norm.d[(y + j) * ref.w + x + i];
              sab += va * vb; saa += va * va; sbb += vb * vb;
            }
          }
          const s = sab / Math.sqrt(saa * sbb + 1e-12);
          scores[(j + R) * (2 * R + 1) + i + R] = s;
          if (s > best) { best = s; bi = i; bj = j; }
        }
      }
      // A clear, single, interior peak only: on the edge of the search the true shift may lie outside it.
      if (best < LOCAL_MIN_SCORE || Math.abs(bi) === R || Math.abs(bj) === R) continue;
      let second = -2;
      for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
        if (Math.max(Math.abs(i - bi), Math.abs(j - bj)) > 1) second = Math.max(second, scores[(j + R) * (2 * R + 1) + i + R]);
      }
      if (second > best * 0.95) continue;
      const at = (i: number, j: number) => scores[(j + R) * (2 * R + 1) + i + R];
      const sub = (l: number, c: number, r: number) => { const den = l - 2 * c + r; return den < 0 ? Math.max(-0.5, Math.min(0.5, (l - r) / (2 * den))) : 0; };
      const k = ty * cols + tx;
      du[k] = bi + sub(at(bi - 1, bj), best, at(bi + 1, bj));
      dv[k] = bj + sub(at(bi, bj - 1), best, at(bi, bj + 1));
      ok[k] = 1; matched++;
    }
  }
  // Fill tiles without a clear match from their matched neighbours (repeatedly), otherwise no residual.
  for (let pass = 0; pass < cols + rows; pass++) {
    let changed = false;
    const next = ok.slice();
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) {
      const k = ty * cols + tx;
      if (ok[k]) continue;
      let su = 0, sv = 0, n = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = tx + ox, y = ty + oy;
        if (x < 0 || y < 0 || x >= cols || y >= rows || !ok[y * cols + x]) continue;
        su += du[y * cols + x]; sv += dv[y * cols + x]; n++;
      }
      if (n) { du[k] = su / n; dv[k] = sv / n; next[k] = 1; changed = true; }
    }
    ok.set(next);
    if (!changed) break;
  }
  // A 3x3 median removes a lone wrong tile; then the field is capped.
  const median = (src: Float32Array) => src.map((_, k) => {
    const tx = k % cols, ty = Math.floor(k / cols), values: number[] = [];
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const x = tx + ox, y = ty + oy;
      if (x >= 0 && y >= 0 && x < cols && y < rows) values.push(src[y * cols + x]);
    }
    values.sort((p, q) => p - q);
    return values[values.length >> 1];
  });
  const mu = cols * rows >= 9 ? median(du) : du, mv = cols * rows >= 9 ? median(dv) : dv;
  let maxShift = 0;
  for (let k = 0; k < mu.length; k++) {
    mu[k] = Math.max(-R, Math.min(R, mu[k])); mv[k] = Math.max(-R, Math.min(R, mv[k]));
    maxShift = Math.max(maxShift, Math.hypot(mu[k], mv[k]) * factor);
  }
  return { field: { cols, rows, cellW, cellH, du: mu, dv: mv, factor }, matched, total: cols * rows, maxShift };
}

/** The residual shift at a full-size pixel, in full pixels (bilinear between tile centres). */
function fieldAt(f: ShiftField, X: number, Y: number): [number, number] {
  const gx = Math.min(f.cols - 1, Math.max(0, X / f.factor / f.cellW - 0.5));
  const gy = Math.min(f.rows - 1, Math.max(0, Y / f.factor / f.cellH - 0.5));
  const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(f.cols - 1, x0 + 1), y1 = Math.min(f.rows - 1, y0 + 1);
  const fx = gx - x0, fy = gy - y0;
  const lerp = (g: Float32Array) => (g[y0 * f.cols + x0] * (1 - fx) + g[y0 * f.cols + x1] * fx) * (1 - fy)
    + (g[y1 * f.cols + x0] * (1 - fx) + g[y1 * f.cols + x1] * fx) * fy;
  return [lerp(f.du) * f.factor, lerp(f.dv) * f.factor];
}

// ---------------------------------------------------------------------------------------------------------------------
// Blending
// ---------------------------------------------------------------------------------------------------------------------

/** Warp the rows a band needs from a source into the reference geometry: RGB 0-1, luminance and a validity mask. */
async function warpBand(source: StackSource, m: Affine, field: ShiftField | null, y0: number, rows: number, maxResidual: number) {
  const w = source.width, h = source.height;
  // Which source rows does this band touch? The corners and edges bound an affine; the residual adds its maximum.
  let vMin = Infinity, vMax = -Infinity;
  for (const Y of [y0, y0 + rows - 1]) for (const X of [0, w - 1]) {
    const v = m.c * X + m.d * Y + m.ty; vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
  }
  const r0 = Math.max(0, Math.floor(vMin - maxResidual) - 2), r1 = Math.min(h, Math.ceil(vMax + maxResidual) + 3);
  const n = w * rows;
  const rgb = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const lum = new Float32Array(n);
  const valid = new Uint8Array(n);
  if (r1 <= r0) return { rgb, lum, valid };
  const src = await source.readRows(r0, r1 - r0);
  const k = 1 / maxOf(source.bits);
  const last = r1 - r0 - 1;
  for (let y = 0; y < rows; y++) {
    const Y = y0 + y;
    for (let x = 0; x < w; x++) {
      let u = m.a * x + m.b * Y + m.tx, v = m.c * x + m.d * Y + m.ty;
      if (field) { const [ru, rv] = fieldAt(field, x, Y); u += ru; v += rv; }
      const i = y * w + x;
      valid[i] = u >= 0 && v >= 0 && u <= w - 1 && v <= h - 1 ? 1 : 0;
      const cu = Math.min(w - 1, Math.max(0, u)), cv = Math.min(last, Math.max(0, Math.min(h - 1, v) - r0));
      const x0 = Math.floor(cu), yA = Math.floor(cv);
      const x1 = Math.min(w - 1, x0 + 1), yB = Math.min(last, yA + 1);
      const fx = cu - x0, fy = cv - yA;
      const p00 = (yA * w + x0) * 4, p10 = (yA * w + x1) * 4, p01 = (yB * w + x0) * 4, p11 = (yB * w + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[p00 + c] * (1 - fx) + src[p10 + c] * fx;
        const bottom = src[p01 + c] * (1 - fx) + src[p11 + c] * fx;
        rgb[c][i] = (top * (1 - fy) + bottom * fy) * k;
      }
      lum[i] = 0.2126 * rgb[0][i] + 0.7152 * rgb[1][i] + 0.0722 * rgb[2][i];
    }
  }
  return { rgb, lum, valid };
}

function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw new StackCancelledError(); }

/** Let a worker (or the page) handle a stop message between heavy steps. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Frames held at once for a stack (one band of every frame plus the output), for the interface to check before it starts. */
export function estimateStackBytes(width: number, height: number): number {
  return width * height * 4 * 2;
}

/** A weight floor so flat areas (sky, a blurred background) average every frame instead of flickering between them. */
const WEIGHT_FLOOR = 1e-10;

export async function stackFocus(sources: readonly StackSource[], options: StackOptions = {}): Promise<StackResult> {
  const { signal, onProgress } = options;
  if (sources.length < MIN_STACK_FRAMES) return { ok: false, reason: 'too-few' };
  if (sources.length > MAX_STACK_FRAMES) return { ok: false, reason: 'too-many' };
  const { width, height, bits } = sources[0];
  if (sources.some((s) => s.width !== width || s.height !== height || s.bits !== bits) || width < 16 || height < 16) {
    return { ok: false, reason: 'size-mismatch' };
  }
  const alignEdge = Math.max(64, Math.min(2048, options.alignEdge ?? 1024));
  const localAlign = options.localAlign !== false;
  const power = Math.max(1, Math.min(12, options.power ?? 4));
  const feather = Math.max(1, Math.round(options.feather ?? Math.max(3, Math.max(width, height) / 400)));
  const frames = sources.length;
  const total = frames + (frames - 1) + frames; // read + align + blend
  let done = 0;
  const tick = (stage: StackStage) => { done++; onProgress?.(Math.min(done, total), total, stage); };

  // 1. A small luminance copy of each frame, for alignment.
  const lums: Plane[] = [];
  let factor = 1;
  for (const source of sources) {
    checkAbort(signal);
    await breathe();
    const l = await luminanceOf(source, alignEdge, signal);
    lums.push(l.plane); factor = l.factor;
    tick('reading');
  }
  const pw = lums[0].w, ph = lums[0].h;

  // 2. Global: the middle frame is the reference; each other frame is matched to the neighbour nearer the reference.
  const reference = Math.floor((frames - 1) / 2);
  const pyramids = lums.map((l) => alignPyramid(l));
  const planeAffines: Affine[] = new Array(frames);
  const scores: number[] = new Array(frames).fill(1);
  planeAffines[reference] = IDENTITY;
  const order: [number, number][] = [];
  for (let i = reference - 1; i >= 0; i--) order.push([i, i + 1]);
  for (let i = reference + 1; i < frames; i++) order.push([i, i - 1]);
  const fields: (ShiftField | null)[] = new Array(frames).fill(null);
  const localStats: FrameAlignment['localTiles'][] = new Array(frames).fill({ matched: 0, total: 0, maxShift: 0 });
  const warnings: StackWarning[] = [];
  for (const [i, near] of order) {
    checkAbort(signal);
    await breathe();
    const result = register(pyramids[near], pyramids[i], pw, ph);
    if (!result.ok) return { ok: false, reason: result.reason, frameNumber: i + 1 };
    // result.affine takes coordinates in `near` to coordinates in frame i; planeAffines[near] takes the reference to `near`.
    planeAffines[i] = compose(result.affine, planeAffines[near]);
    scores[i] = result.score;
    // 2b. Local: what is left after the global transform, measured straight against the reference.
    if (localAlign) {
      const local = localField(lums[reference], warpPlane(lums[i], planeAffines[i]), factor);
      localStats[i] = { matched: local.matched, total: local.total, maxShift: local.maxShift };
      if (local.matched > 0) fields[i] = local.field;
      else warnings.push({ code: 'local-fallback', frameIndex: i });
    }
    tick('aligning');
  }
  const affines = planeAffines.map((m) => affineToFull(m, factor));
  const alignment: FrameAlignment[] = affines.map((m, i) => ({
    dx: m.tx, dy: m.ty, scale: Math.hypot(m.a, m.c), rotationDegrees: (Math.atan2(m.c, m.a) * 180) / Math.PI,
    score: scores[i], localTiles: localStats[i],
  }));

  // Are the frames actually different in focus? If every frame is about as sharp everywhere, stacking cannot help.
  {
    const maps = lums.map((lum, i) => sharpnessMap(i === reference ? lum.d : warpPlane(lum, planeAffines[i]).d, pw, ph, 2));
    let differing = 0;
    for (let p = 0; p < pw * ph; p++) {
      let hi = 0, lo = Infinity;
      for (const m of maps) { if (m[p] > hi) hi = m[p]; if (m[p] < lo) lo = m[p]; }
      if (hi > 0.004 && hi > lo * 1.5) differing++;
    }
    if (differing / (pw * ph) < 0.02) warnings.push({ code: 'equally-sharp' });
  }

  // 3 and 4. Blend in bands of rows with a margin for the sharpness and feather blurs, one frame at a time.
  const margin = Math.min(height, 2 * (feather * 2 + 3) + 2);
  const bytesPerRow = width * 4 * (4 /* sums */ + 3 + 1 + 1 + 3 /* one frame: rgb, lum, lap, weight + temporaries */) + width;
  const maxWorking = options.maxWorkingBytes ?? 192 * 1024 * 1024;
  const coreRows = Math.max(16, Math.min(height, Math.floor(maxWorking / bytesPerRow) - 2 * margin));
  const bandCount = Math.ceil(height / coreRows);
  const out = new Uint16Array(width * height * 4);
  const picks = new Float64Array(frames);
  const maxResidual = LOCAL_RANGE * factor + 1;

  for (let band = 0; band < bandCount; band++) {
    const c0 = band * coreRows, c1 = Math.min(height, c0 + coreRows);
    const y0 = Math.max(0, c0 - margin), y1 = Math.min(height, c1 + margin), rows = y1 - y0;
    const n = width * rows;
    const sums = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    const weightSum = new Float32Array(n);
    const bestWeight = new Float32Array(n);
    const bestFrame = new Uint8Array(n).fill(reference);
    for (let i = 0; i < frames; i++) {
      checkAbort(signal);
      await breathe();
      const warped = await warpBand(sources[i], affines[i], fields[i], y0, rows, maxResidual);
      const sharp = sharpnessMap(warped.lum, width, rows, 2);
      const weight = new Float32Array(n);
      for (let p = 0; p < n; p++) weight[p] = warped.valid[p] ? sharp[p] ** power + WEIGHT_FLOOR : 0;
      // Feathering: two box passes make a soft (nearly Gaussian) transition between frames, never a hard seam.
      const soft = boxBlur(boxBlur(weight, width, rows, feather), width, rows, feather);
      for (let p = 0; p < n; p++) {
        const wt = warped.valid[p] ? soft[p] : 0;
        if (wt <= 0) continue;
        sums[0][p] += wt * warped.rgb[0][p]; sums[1][p] += wt * warped.rgb[1][p]; sums[2][p] += wt * warped.rgb[2][p];
        weightSum[p] += wt;
        if (wt > bestWeight[p]) { bestWeight[p] = wt; bestFrame[p] = i; }
      }
      tick('blending');
    }
    const skip = c0 - y0;
    let refBand: Awaited<ReturnType<typeof warpBand>> | null = null;
    for (let y = c0; y < c1; y++) {
      for (let x = 0; x < width; x++) {
        const p = (y - c0 + skip) * width + x, dst = (y * width + x) * 4;
        let total = weightSum[p];
        if (!(total > 0)) {
          // Nothing valid here (a corner no frame covers after alignment): the reference frame's own pixel.
          refBand ??= await warpBand(sources[reference], IDENTITY, null, y0, rows, 0);
          for (let c = 0; c < 3; c++) out[dst + c] = Math.round(refBand.rgb[c][p] * 65535);
          out[dst + 3] = 65535;
          picks[reference]++;
          continue;
        }
        total = 1 / total;
        for (let c = 0; c < 3; c++) out[dst + c] = Math.round(Math.min(1, Math.max(0, sums[c][p] * total)) * 65535);
        out[dst + 3] = 65535;
        picks[bestFrame[p]]++;
      }
    }
  }

  const contribution = Array.from(picks, (count) => count / (width * height));
  contribution.forEach((share, i) => { if (share < 0.01) warnings.push({ code: 'frame-unused', frameIndex: i }); });
  if (Math.max(...contribution) > 0.95 && !warnings.some((w) => w.code === 'equally-sharp')) warnings.push({ code: 'one-frame-dominates' });
  return {
    ok: true, width, height, data: out, sourceBits: bits, contribution, alignment, affines, referenceIndex: reference,
    bands: bandCount, warnings, settings: { power, feather, alignEdge, localAlign },
  };
}

/** Convenience for decoded frames (tests, small pictures). */
export function stackFrames(frames: readonly StackFrame[], options: StackOptions = {}): Promise<StackResult> {
  if (frames.some((f) => f.data.length !== f.width * f.height * 4)) return Promise.resolve({ ok: false, reason: 'size-mismatch' });
  return stackFocus(frames.map(frameSource), options);
}
