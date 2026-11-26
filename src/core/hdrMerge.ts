import { applyPhotoEditLinear, decodeEncoded, encodeLinear, type PhotoEdit } from './photoEdits';

/**
 * HDR merge: combine a bracketed burst (the same scene shot darker and brighter) into one picture that keeps the
 * highlights of the dark frames and the shadows of the bright ones.
 *
 * Pure and platform-free (no DOM, no canvas), so it runs unchanged in a worker, on the desktop and on a phone, and is
 * unit-tested on synthetic brackets. NOTHING IS GENERATED: before the tone step every output pixel is a weighted
 * average of the same aligned place in the real frames, each scaled by its measured exposure.
 *
 * Steps:
 *  1. A small linear-light luminance copy of every frame (read in bands, so a 45-megapixel bracket never sits in memory
 *     at once), with the share of clipped and near-black pixels in each cell.
 *  2. Order the frames by brightness and line each one up with its neighbour: median threshold bitmaps (exposure
 *     invariant), coarse to fine, then a sub-pixel refinement on log luminance. A weak match REFUSES the merge.
 *  3. Measure each frame's exposure from its own pixels (the median brightness ratio where both neighbours are well
 *     exposed), chained to the reference, the middle exposure. Brackets that barely differ are refused.
 *  4. Ghost masks: where a frame disagrees with the best-exposed frame there by more than the threshold (a bird that
 *     flew, a branch that moved), that frame is left out there, widened and feathered. Moving subjects come from one
 *     frame only, so they never double.
 *  5. The merge in linear light, band by band at full size: each frame's pixel divided by its exposure, weighted by how
 *     well exposed it is there (none when clipped or black) and by its exposure (longer exposures carry less noise).
 *  6. Tone: a global curve (extended Reinhard, white at the bracket's measured brightest highlight) fits the extra
 *     range under white without clipping, then the editor's own develop maths (`applyPhotoEditLinear`, Highlights and
 *     Shadows) makes the display-encoded 16-bit result.
 */

export type PixelData = Uint8ClampedArray | Uint8Array | Uint16Array | Float32Array;

/** One frame read on demand: interleaved RGBA rows `y0` to `y0 + rows - 1`, display-encoded sRGB, in its own sample type. */
export interface HdrSource {
  width: number;
  height: number;
  /** 8 (0-255), 16 (0-65535) or 32 (float 0-1). */
  bits: 8 | 16 | 32;
  readRows(y0: number, rows: number): PixelData | Promise<PixelData>;
}

export const MIN_HDR_FRAMES = 2;
export const MAX_HDR_FRAMES = 7;

export type HdrStage = 'reading' | 'aligning' | 'merging';

/**
 * The tone step. `white` is the merged light (1 = white in the reference frame) that becomes white, normally the
 * bracket's measured brightest highlight; Highlights and Shadows are the editor's own sliders (-2 to 2).
 */
export interface HdrTone { white: number; highlights: number; shadows: number }
export const DEFAULT_HDR_TONE: HdrTone = { white: 1, highlights: -0.4, shadows: 0.8 };

export interface HdrOptions {
  /** Longest edge of the luminance copy used to line frames up and find ghosts. Default 1024. */
  alignEdge?: number;
  /** Largest shift searched, as a share of the long edge. Default 0.05. */
  maxShift?: number;
  /** Leave moving things out of all but one frame. Default on (tests compare with and without). */
  ghostRemoval?: boolean;
  /** How far (in stops) a frame may disagree before it is treated as a ghost there. Default 0.6. */
  ghostThreshold?: number;
  tone?: Partial<HdrTone>;
  /** Bytes one band of the merge may use. Default 192 MB. */
  maxWorkingBytes?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, stage: HdrStage) => void;
}

export type HdrRefusalReason = 'too-few' | 'too-many' | 'size-mismatch' | 'same-exposure' | 'unrelated';
export interface HdrRefusal { ok: false; reason: HdrRefusalReason; /** 1-based, in the order given. */ frameNumber?: number }

export interface HdrWarning { code: 'ghosts-removed' | 'highlights-clipped' | 'shadows-dark'; frameIndex?: number }

export interface HdrAlignment { dx: number; dy: number; /** How well the bitmaps matched, 0 to 1. */ score: number }

export interface HdrSuccess {
  ok: true;
  width: number;
  height: number;
  /** Interleaved RGB, display-encoded sRGB, 0 to 65535. */
  data: Uint16Array;
  referenceIndex: number;
  /** Each frame's measured exposure in stops against the reference (the reference is 0). */
  exposureEv: number[];
  alignment: HdrAlignment[];
  /** Share of the picture where each frame was left out as a ghost. */
  ghostShare: number[];
  /** Share of the picture still clipped in the darkest frame (highlights no frame holds). */
  clippedShare: number;
  tone: HdrTone;
  settings: { alignEdge: number; ghostRemoval: boolean; ghostThreshold: number };
  sourceBits: 8 | 16 | 32;
  warnings: HdrWarning[];
}

export type HdrResult = HdrSuccess | HdrRefusal;

const LIN8 = Float32Array.from({ length: 256 }, (_, i) => decodeEncoded(i / 255));
let lin16: Float32Array | null = null;
function linearTable(bits: 8 | 16 | 32): Float32Array | null {
  if (bits === 8) return LIN8;
  if (bits === 16) return (lin16 ??= Float32Array.from({ length: 65536 }, (_, i) => decodeEncoded(i / 65535)));
  return null;
}

const smoothstep = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const LUMA = [0.2126, 0.7152, 0.0722] as const;
/** Linear-light thresholds for "well exposed": darker than this is noise, brighter is near clipping. */
const LOW = decodeEncoded(0.02), LOW_FULL = decodeEncoded(0.15), HIGH_FULL = decodeEncoded(0.85), HIGH = decodeEncoded(0.97);
const CELL_LOW = decodeEncoded(0.05), CELL_HIGH = decodeEncoded(0.9);

/** A frame's small copy: per cell, mean linear luminance and the share (0-255) of clipped and near-black pixels. */
interface Small { y: Float32Array; clip: Uint8Array; dark: Uint8Array; mean: number }

async function readSmall(source: HdrSource, s: number, lw: number, lh: number, signal?: AbortSignal): Promise<Small> {
  const { width, height } = source;
  const table = linearTable(source.bits);
  const scale = source.bits === 8 ? 255 : source.bits === 16 ? 65535 : 1;
  const sum = new Float64Array(lw * lh), clip = new Float64Array(lw * lh), dark = new Float64Array(lw * lh), count = new Uint32Array(lw * lh);
  const bandRows = Math.max(s, Math.floor(256 / s) * s);
  for (let y0 = 0; y0 < height; y0 += bandRows) {
    signal?.throwIfAborted();
    const rows = Math.min(bandRows, height - y0);
    const data = await source.readRows(y0, rows);
    for (let r = 0; r < rows; r++) {
      const cy = Math.floor((y0 + r) / s) * lw;
      let at = r * width * 4;
      for (let x = 0; x < width; x++, at += 4) {
        let red: number, green: number, blue: number, top: number;
        if (table) { red = table[data[at]]; green = table[data[at + 1]]; blue = table[data[at + 2]]; }
        else { red = decodeEncoded(data[at] / scale); green = decodeEncoded(data[at + 1] / scale); blue = decodeEncoded(data[at + 2] / scale); }
        top = Math.max(red, green, blue);
        const cell = cy + Math.floor(x / s);
        sum[cell] += LUMA[0] * red + LUMA[1] * green + LUMA[2] * blue;
        if (top >= HIGH) clip[cell] += 1;
        if (top <= LOW) dark[cell] += 1;
        count[cell] += 1;
      }
    }
  }
  const y = new Float32Array(lw * lh), c = new Uint8Array(lw * lh), d = new Uint8Array(lw * lh);
  let total = 0;
  for (let i = 0; i < y.length; i++) {
    const n = count[i] || 1;
    y[i] = sum[i] / n; c[i] = Math.round(clip[i] / n * 255); d[i] = Math.round(dark[i] / n * 255);
    total += y[i];
  }
  return { y, clip: c, dark: d, mean: total / y.length };
}

/** Bilinear sample of a cell grid, NaN outside it. */
function sample(grid: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return NaN;
  const x0 = Math.min(w - 2, Math.floor(x)), y0 = Math.min(h - 2, Math.floor(y));
  if (w < 2 || h < 2) return grid[0];
  const fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (grid[i] * (1 - fx) + grid[i + 1] * fx) * (1 - fy) + (grid[i + w] * (1 - fx) + grid[i + w + 1] * fx) * fy;
}
/** The same, held at the edge, for the ghost masks (always a number). Pixel coordinates to cell coordinates. */
function maskAt(grid: Float32Array, w: number, h: number, s: number, x: number, y: number): number {
  const v = sample(grid, w, h, Math.max(0, Math.min(w - 1, (x + 0.5) / s - 0.5)), Math.max(0, Math.min(h - 1, (y + 0.5) / s - 0.5)));
  return Number.isFinite(v) ? v : 1;
}
function nearest(grid: Uint8Array, w: number, h: number, x: number, y: number): number {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 255;
  return grid[yi * w + xi];
}

/** Median threshold bitmap (Ward 2003) of an encoded-luminance grid, with an exclusion bitmap near the median. */
function bitmaps(enc: Float32Array): { bit: Uint8Array; use: Uint8Array } {
  const sorted = Float32Array.from(enc).sort();
  const median = sorted[sorted.length >> 1];
  const bit = new Uint8Array(enc.length), use = new Uint8Array(enc.length);
  for (let i = 0; i < enc.length; i++) { bit[i] = enc[i] > median ? 1 : 0; use[i] = Math.abs(enc[i] - median) > 0.012 ? 1 : 0; }
  return { bit, use };
}
function halve(grid: Float32Array, w: number, h: number): { grid: Float32Array; w: number; h: number } {
  const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), out = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const i = 2 * y * w + 2 * x;
    out[y * hw + x] = (grid[i] + grid[Math.min(i + 1, grid.length - 1)] + grid[Math.min(i + w, grid.length - 1)] + grid[Math.min(i + w + 1, grid.length - 1)]) / 4;
  }
  return { grid: out, w: hw, h: hh };
}
/** Share of usable pixels whose bits disagree with `a` shifted by (dx, dy) against `b`; 1 when too little overlaps. */
function bitError(a: ReturnType<typeof bitmaps>, b: ReturnType<typeof bitmaps>, w: number, h: number, dx: number, dy: number): number {
  let wrong = 0, used = 0;
  for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y++) {
    for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x++) {
      const ib = y * w + x, ia = ib + dy * w + dx;
      if (a.use[ia] && b.use[ib]) { used++; if (a.bit[ia] !== b.bit[ib]) wrong++; }
    }
  }
  return used < Math.max(16, w * h * 0.1) ? 1 : wrong / used;
}

/** Integer shift (cells) that puts frame `a` on frame `b`: a(x + d) ≈ b(x). */
function alignBitmaps(a: Float32Array, b: Float32Array, w: number, h: number, maxShift: number): { dx: number; dy: number; error: number } {
  const levels: Array<{ a: Float32Array; b: Float32Array; w: number; h: number }> = [{ a, b, w, h }];
  while (levels.length < 12 && (1 << levels.length) <= maxShift && Math.min(levels[levels.length - 1].w, levels[levels.length - 1].h) >= 32) {
    const top = levels[levels.length - 1];
    const ha = halve(top.a, top.w, top.h), hb = halve(top.b, top.w, top.h);
    levels.push({ a: ha.grid, b: hb.grid, w: ha.w, h: ha.h });
  }
  let dx = 0, dy = 0, error = 1;
  for (let l = levels.length - 1; l >= 0; l--) {
    const { a: la, b: lb, w: lw, h: lh } = levels[l];
    const ba = bitmaps(la), bb = bitmaps(lb);
    dx *= 2; dy *= 2;
    const reach = l === levels.length - 1 ? 2 : 1;
    let best = { dx, dy, error: Infinity };
    for (let sy = -reach; sy <= reach; sy++) for (let sx = -reach; sx <= reach; sx++) {
      const e = bitError(ba, bb, lw, lh, dx + sx, dy + sy);
      if (e < best.error - 1e-9 || (Math.abs(e - best.error) <= 1e-9 && Math.abs(sx) + Math.abs(sy) < Math.abs(best.dx - dx) + Math.abs(best.dy - dy))) best = { dx: dx + sx, dy: dy + sy, error: e };
    }
    dx = best.dx; dy = best.dy; error = best.error;
  }
  return { dx, dy, error };
}

/** Exposure-invariant mismatch: variance of the log-luminance difference where both cells are well exposed. */
function logVariance(a: Small, b: Small, w: number, h: number, dx: number, dy: number): { variance: number; median: number; used: number } {
  const diffs: number[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt(w * h / 40000)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = y * w + x;
    const yb = b.y[i];
    if (b.clip[i] || b.dark[i] || yb < CELL_LOW || yb > CELL_HIGH) continue;
    const ya = sample(a.y, w, h, x + dx, y + dy);
    if (!(ya >= CELL_LOW && ya <= CELL_HIGH) || nearest(a.clip, w, h, x + dx, y + dy) || nearest(a.dark, w, h, x + dx, y + dy)) continue;
    diffs.push(Math.log(yb / ya));
  }
  if (diffs.length < 8) return { variance: Infinity, median: 0, used: diffs.length };
  let mean = 0;
  for (const d of diffs) mean += d;
  mean /= diffs.length;
  let v = 0;
  for (const d of diffs) v += (d - mean) ** 2;
  diffs.sort((p, q) => p - q);
  return { variance: v / diffs.length, median: diffs[diffs.length >> 1], used: diffs.length };
}

/**
 * Polish the bitmap shift: the best whole-cell shift nearby by log-luminance variance (the bitmaps' median moves when
 * new content enters at an edge), then a parabola through the neighbours for the sub-cell part.
 */
function refine(a: Small, b: Small, w: number, h: number, dx0: number, dy0: number): { dx: number; dy: number } {
  let dx = dx0, dy = dy0, c0 = logVariance(a, b, w, h, dx, dy).variance;
  for (let sy = -2; sy <= 2; sy++) for (let sx = -2; sx <= 2; sx++) {
    if (!sx && !sy) continue;
    const c = logVariance(a, b, w, h, dx0 + sx, dy0 + sy).variance;
    if (c < c0) { c0 = c; dx = dx0 + sx; dy = dy0 + sy; }
  }
  if (!Number.isFinite(c0)) return { dx, dy };
  const axis = (minus: number, plus: number) => {
    const den = minus - 2 * c0 + plus;
    if (!Number.isFinite(den) || den <= 1e-12) return 0;
    return Math.max(-0.5, Math.min(0.5, (minus - plus) / (2 * den)));
  };
  return {
    dx: dx + axis(logVariance(a, b, w, h, dx - 1, dy).variance, logVariance(a, b, w, h, dx + 1, dy).variance),
    dy: dy + axis(logVariance(a, b, w, h, dx, dy - 1).variance, logVariance(a, b, w, h, dx, dy + 1).variance),
  };
}

/** Grow the left-out (low) parts of a mask by one cell, then soften twice, so a ghost's edges are covered. */
function widenAndFeather(mask: Float32Array, w: number, h: number): Float32Array {
  const grown = new Float32Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 1;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const xx = x + ox, yy = y + oy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h) m = Math.min(m, mask[yy * w + xx]);
    }
    grown[y * w + x] = m;
  }
  let cur = grown;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(cur.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let total = 0, n = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const xx = x + ox, yy = y + oy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) { total += cur[yy * w + xx]; n++; }
      }
      next[y * w + x] = total / n;
    }
    cur = next;
  }
  return cur;
}

/**
 * The tone step, in place: RGBA linear light relative to the reference exposure (may run far above 1) becomes
 * display-encoded 0 to 1. Luminance goes through extended Reinhard, L (1 + L / white²) / (1 + L), so `white` lands on
 * white and nothing below it clips, with hue kept; with `white` at 1 (nothing brighter than the reference held) it is
 * the identity. Then the editor's own develop maths applies Highlights and Shadows.
 */
export function toneHdr(buffer: Float32Array, tone: HdrTone): void {
  const white = Math.max(1, tone.white);
  const w2 = white * white;
  for (let o = 0; o < buffer.length; o += 4) {
    let red = buffer[o], green = buffer[o + 1], blue = buffer[o + 2];
    const lum = LUMA[0] * red + LUMA[1] * green + LUMA[2] * blue;
    if (white > 1 && lum > 0) {
      const rolled = Math.min(1, lum * (1 + lum / w2) / (1 + lum));
      const f = rolled / lum;
      red *= f; green *= f; blue *= f;
      const peak = Math.max(red, green, blue);
      if (peak > 1) {
        const t = (1 - rolled) / (peak - rolled);
        red = rolled + (red - rolled) * t; green = rolled + (green - rolled) * t; blue = rolled + (blue - rolled) * t;
      }
      buffer[o] = red; buffer[o + 1] = green; buffer[o + 2] = blue;
    }
  }
  const edit: PhotoEdit = { exposure: 0, warmth: 0, colour: 0, highlights: tone.highlights, shadows: tone.shadows };
  applyPhotoEditLinear(buffer, edit);
}

export async function mergeHdr(sources: readonly HdrSource[], options: HdrOptions = {}): Promise<HdrResult> {
  const n = sources.length;
  if (n < MIN_HDR_FRAMES) return { ok: false, reason: 'too-few' };
  if (n > MAX_HDR_FRAMES) return { ok: false, reason: 'too-many' };
  const { width, height } = sources[0];
  for (let i = 1; i < n; i++) if (sources[i].width !== width || sources[i].height !== height) return { ok: false, reason: 'size-mismatch', frameNumber: i + 1 };
  const { signal, onProgress } = options;
  const alignEdge = Math.max(64, Math.min(2048, Math.round(options.alignEdge ?? 1024)));
  const ghostRemoval = options.ghostRemoval ?? true;
  const ghostThreshold = Math.max(0.1, Math.min(3, options.ghostThreshold ?? 0.6));
  const tone: HdrTone = { ...DEFAULT_HDR_TONE, ...options.tone };
  tone.white = Math.max(1, Math.min(64, tone.white));
  const sourceBits = sources.reduce<8 | 16 | 32>((bits, s) => (s.bits > bits ? s.bits : bits), 8);

  // 1. Small copies.
  const s = Math.max(1, Math.ceil(Math.max(width, height) / alignEdge));
  const lw = Math.ceil(width / s), lh = Math.ceil(height / s);
  const small: Small[] = [];
  for (let i = 0; i < n; i++) {
    onProgress?.(i, n, 'reading');
    small.push(await readSmall(sources[i], s, lw, lh, signal));
  }
  onProgress?.(n, n, 'reading');

  // 2. Order by brightness; the reference is the middle exposure (the darker middle one of an even count).
  const order = [...small.keys()].sort((a, b) => small[a].mean - small[b].mean);
  const refPos = (n - 1) >> 1;
  const ref = order[refPos];
  const enc = small.map((f) => f.y.map((v) => encodeLinear(v)));
  const maxShift = Math.max(2, Math.ceil(Math.max(lw, lh) * Math.max(0.005, Math.min(0.25, options.maxShift ?? 0.05))));
  const offset = new Array<{ dx: number; dy: number }>(n);
  const score = new Array<number>(n).fill(1);
  const logR = new Array<number>(n).fill(0);
  offset[ref] = { dx: 0, dy: 0 };
  let aligned = 0;
  // Walk outwards from the reference, each frame lined up with its already placed neighbour (chained), so a 4-stop
  // difference never has to be matched directly.
  const walk = [...Array.from({ length: refPos }, (_, k) => [order[refPos - 1 - k], order[refPos - k]]), ...Array.from({ length: n - 1 - refPos }, (_, k) => [order[refPos + 1 + k], order[refPos + k]])];
  for (const [frame, anchor] of walk) {
    signal?.throwIfAborted();
    onProgress?.(aligned, n - 1, 'aligning');
    const coarse = alignBitmaps(enc[frame], enc[anchor], lw, lh, maxShift);
    if (coarse.error > 0.25) return { ok: false, reason: 'unrelated', frameNumber: frame + 1 };
    const fine = refine(small[frame], small[anchor], lw, lh, coarse.dx, coarse.dy);
    const fit = logVariance(small[frame], small[anchor], lw, lh, fine.dx, fine.dy);
    if (fit.used < Math.max(8, Math.min(200, lw * lh * 0.01))) return { ok: false, reason: 'unrelated', frameNumber: frame + 1 };
    // Cells to full-size pixels.
    offset[frame] = { dx: offset[anchor].dx + fine.dx * s, dy: offset[anchor].dy + fine.dy * s };
    // log(anchor / frame): the frame's exposure relative to the anchor is the negative of the median difference.
    logR[frame] = logR[anchor] - fit.median;
    score[frame] = Math.max(0, Math.min(1, 1 - 2 * coarse.error));
    aligned++;
  }
  onProgress?.(n - 1, n - 1, 'aligning');
  const spread = (Math.max(...logR) - Math.min(...logR)) / Math.LN2;
  if (spread < 0.4) return { ok: false, reason: 'same-exposure' };
  const ratio = logR.map((v) => Math.exp(v));

  // 4. Ghost masks on the small grid, in reference positions. 1 = use the frame here.
  const masks = small.map(() => new Float32Array(lw * lh).fill(1));
  const byCloseness = [...small.keys()].sort((a, b) => Math.abs(logR[a]) - Math.abs(logR[b]));
  const darkest = order[0];
  let clippedCells = 0;
  const vals = new Float64Array(n), valid = new Uint8Array(n);
  const brightest = new Array<number>(lw * lh);
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    const cell = y * lw + x;
    for (let i = 0; i < n; i++) {
      const fx = x + offset[i].dx / s, fy = y + offset[i].dy / s;
      const v = sample(small[i].y, lw, lh, fx, fy);
      vals[i] = v / ratio[i];
      valid[i] = v >= CELL_LOW && v <= CELL_HIGH && nearest(small[i].clip, lw, lh, fx, fy) < 6 && nearest(small[i].dark, lw, lh, fx, fy) < 6 ? 1 : 0;
    }
    if (nearest(small[darkest].clip, lw, lh, x + offset[darkest].dx / s, y + offset[darkest].dy / s) > 127) clippedCells++;
    let anchor = -1;
    for (const i of byCloseness) if (valid[i]) { anchor = i; break; }
    // The cell's light as merged: from its best-exposed frame, else the darkest frame (it clips last).
    brightest[cell] = anchor >= 0 ? vals[anchor] : vals[darkest];
    if (!ghostRemoval || anchor < 0) continue;
    const limit = ghostThreshold * Math.LN2;
    // Compare what each frame shows with what the anchor says it should show at that frame's exposure, both held
    // inside the range a frame can record, so a clipped or near-black frame is judged by what it could have shown.
    const clamp = (v: number) => Math.min(HIGH, Math.max(CELL_LOW, v));
    for (let i = 0; i < n; i++) {
      if (i === anchor || !Number.isFinite(vals[i])) continue;
      const d = Math.abs(Math.log(clamp(vals[i] * ratio[i]) / clamp(vals[anchor] * ratio[i])));
      masks[i][cell] = 1 - smoothstep(limit * 0.7, limit, d);
    }
  }
  const feathered = ghostRemoval ? masks.map((m) => widenAndFeather(m, lw, lh)) : masks;
  // White for the tone step: the brightest light the bracket holds (99.5th percentile of cells, so one hot pixel does not set it).
  if (options.tone?.white === undefined) {
    const sorted = brightest.filter(Number.isFinite).sort((a, b) => a - b);
    tone.white = Math.max(1, Math.min(64, sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.995))] : 1));
  }
  const ghostShare = feathered.map((m, i) => {
    if (i === ref) return 0;
    let out = 0;
    for (let c = 0; c < m.length; c++) if (m[c] < 0.5) out++;
    return out / m.length;
  });

  // 5 and 6. Merge band by band, then tone.
  const outData = new Uint16Array(width * height * 3);
  const perRow = width * (n * 20 + 16);
  const bandRows = Math.max(8, Math.min(height, Math.floor((options.maxWorkingBytes ?? 192 * 1024 * 1024) / perRow)));
  const bands = Math.ceil(height / bandRows);
  const tables = sources.map((src) => linearTable(src.bits));
  const scales = sources.map((src) => (src.bits === 8 ? 255 : src.bits === 16 ? 65535 : 1));
  const exposureWeight = ratio.map((r) => Math.min(16, Math.max(1 / 16, r)));
  const px = new Float32Array(n * 3), zs = new Float32Array(n), ms = new Float32Array(n), inside = new Uint8Array(n);
  for (let band = 0; band < bands; band++) {
    signal?.throwIfAborted();
    onProgress?.(band, bands, 'merging');
    const y0 = band * bandRows, rows = Math.min(bandRows, height - y0);
    const reads = await Promise.all(sources.map(async (src, i) => {
      const top = Math.max(0, Math.min(height - 1, y0 + Math.floor(offset[i].dy)));
      const bottom = Math.max(top, Math.min(height - 1, y0 + rows - 1 + Math.ceil(offset[i].dy) + 1));
      return { top, rows: bottom - top + 1, data: await src.readRows(top, bottom - top + 1) };
    }));
    const buffer = new Float32Array(width * rows * 4);
    for (let r = 0; r < rows; r++) {
      const y = y0 + r;
      for (let x = 0; x < width; x++) {
        for (let i = 0; i < n; i++) {
          const fx = x + offset[i].dx, fy = y + offset[i].dy;
          const read = reads[i];
          if (fx < 0 || fy < 0 || fx > width - 1 || fy > height - 1 || fy < read.top || fy > read.top + read.rows - 1) { inside[i] = 0; continue; }
          inside[i] = 1;
          const x0 = Math.min(width - 1, Math.floor(fx)), x1 = Math.min(width - 1, x0 + 1);
          const yy0 = Math.min(read.top + read.rows - 1, Math.floor(fy)), yy1 = Math.min(read.top + read.rows - 1, yy0 + 1);
          const ax = fx - x0, ay = fy - yy0;
          const table = tables[i], sc = scales[i], data = read.data;
          const i00 = ((yy0 - read.top) * width + x0) * 4, i10 = ((yy0 - read.top) * width + x1) * 4;
          const i01 = ((yy1 - read.top) * width + x0) * 4, i11 = ((yy1 - read.top) * width + x1) * 4;
          let top = 0;
          const l = (v: number) => (table ? table[v] : decodeEncoded(v / sc));
          for (let c = 0; c < 3; c++) {
            const v = ax === 0 && ay === 0 ? l(data[i00 + c])
              : (l(data[i00 + c]) * (1 - ax) + l(data[i10 + c]) * ax) * (1 - ay) + (l(data[i01 + c]) * (1 - ax) + l(data[i11 + c]) * ax) * ay;
            px[i * 3 + c] = v;
            if (v > top) top = v;
          }
          zs[i] = top;
          ms[i] = ghostRemoval ? maskAt(feathered[i], lw, lh, s, x, y) : 1;
        }
        let wr = 0, wg = 0, wb = 0, wt = 0;
        for (let i = 0; i < n; i++) {
          if (!inside[i]) continue;
          const z = zs[i];
          const w = ms[i] * smoothstep(LOW, LOW_FULL, z) * (1 - smoothstep(HIGH_FULL, HIGH, z)) * exposureWeight[i];
          if (w <= 0) continue;
          wr += w * px[i * 3] / ratio[i]; wg += w * px[i * 3 + 1] / ratio[i]; wb += w * px[i * 3 + 2] / ratio[i]; wt += w;
        }
        if (wt < 1e-6) {
          // No frame is well exposed here: the brightest unclipped frame that is not a ghost here, else the darkest.
          let pick = -1;
          for (let p = n - 1; p >= 0; p--) { const i = order[p]; if (inside[i] && ms[i] >= 0.5 && zs[i] < HIGH) { pick = i; break; } }
          if (pick < 0) for (let p = 0; p < n; p++) { const i = order[p]; if (inside[i] && ms[i] >= 0.5) { pick = i; break; } }
          if (pick < 0) pick = ref;
          wr = px[pick * 3] / ratio[pick]; wg = px[pick * 3 + 1] / ratio[pick]; wb = px[pick * 3 + 2] / ratio[pick]; wt = 1;
        }
        const red = wr / wt, green = wg / wt, blue = wb / wt;
        const o = (r * width + x) * 4;
        buffer[o] = red; buffer[o + 1] = green; buffer[o + 2] = blue; buffer[o + 3] = 1;
      }
    }
    toneHdr(buffer, tone);
    for (let p = 0, q = y0 * width * 3; p < width * rows; p++, q += 3) {
      outData[q] = Math.round(Math.min(1, Math.max(0, buffer[p * 4])) * 65535);
      outData[q + 1] = Math.round(Math.min(1, Math.max(0, buffer[p * 4 + 1])) * 65535);
      outData[q + 2] = Math.round(Math.min(1, Math.max(0, buffer[p * 4 + 2])) * 65535);
    }
  }
  onProgress?.(bands, bands, 'merging');

  const clippedShare = clippedCells / (lw * lh);
  const warnings: HdrWarning[] = [];
  ghostShare.forEach((share, i) => { if (share > 0.005) warnings.push({ code: 'ghosts-removed', frameIndex: i }); });
  if (clippedShare > 0.002) warnings.push({ code: 'highlights-clipped' });
  return {
    ok: true, width, height, data: outData, referenceIndex: ref,
    exposureEv: logR.map((v) => v / Math.LN2),
    alignment: offset.map((o, i) => ({ dx: o.dx, dy: o.dy, score: score[i] })),
    ghostShare, clippedShare, tone, settings: { alignEdge, ghostRemoval, ghostThreshold }, sourceBits, warnings,
  };
}
