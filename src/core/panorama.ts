/**
 * Panorama stitching from overlapping frames, pure and synchronous apart from cooperative yields.
 *
 * 1. Each frame is reduced to a small grey working copy (long edge `workEdge`), and corners are found on it (Harris,
 *    spread over a grid) with a normalised 8×8 patch descriptor around each one.
 * 2. Neighbouring frames (in shooting order) are matched: nearest neighbour with a ratio test and a mutual check.
 * 3. Each matched point is placed on a cylinder of focal length f (from the camera's 35 mm equivalent when known,
 *    otherwise estimated: the f that makes every pair agree best). A pair is then related by a small rigid move
 *    (shift plus a little roll), found by RANSAC and refined by least squares on the inliers.
 * 4. Every frame is placed relative to the middle frame, its exposure is matched to its neighbours over the overlap
 *    (a per-channel gain, recorded), and the full-size frames are resampled onto the cylinder and blended with a
 *    feathered weight that falls to zero at each frame's edge, so seams are soft.
 * 5. The honest crop: the largest rectangle where every pixel is covered by at least one real frame. Nothing outside
 *    it is kept, and nothing is invented: a pixel no frame covers is never filled. Composition checks that every
 *    output pixel had real coverage, and refuses otherwise.
 *
 * Refuses, with a reason, rather than guessing: too few or too many frames, different sizes, too little detail,
 * frames that do not overlap, ambiguous (repeating) matches, a vertical sweep (not supported yet), or an output too
 * large for the device.
 */

export const MIN_PANO_FRAMES = 2;
export const MAX_PANO_FRAMES = 12;

export interface PanoSource {
  width: number;
  height: number;
  /** RGBA, row-major. 8-bit (0..255) or 16-bit (0..65535). */
  data: Uint8ClampedArray | Uint8Array | Uint16Array;
  bits: 8 | 16;
}

export type PanoStage = 'matching' | 'placing' | 'blending';

export interface PanoOptions {
  /** Focal length in full-size pixels, when the camera says (35 mm equivalent / 36 × the long edge). Null: estimate. */
  focalPx?: number | null;
  /** Long edge of the working copy used for matching. */
  workEdge?: number;
  /** Width of the soft blend at a frame's edge, as a share of the frame's shorter side. */
  feather?: number;
  /** Match each frame's exposure and colour to its neighbours over the overlap. */
  matchExposure?: boolean;
  /** Largest output the device can hold (pixels). */
  maxOutputPixels?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, stage: PanoStage) => void;
}

export interface FramePlacement {
  /** Where the frame sits on the panorama's cylinder relative to the reference frame, in full-size pixels. */
  du: number;
  dv: number;
  rotationDegrees: number;
  /** Matches with the previous frame that agreed with the placement, and how many were tried (0 for the first). */
  inliers: number;
  matches: number;
}

export type PanoWarningCode = 'exposure-differs' | 'seams-visible' | 'large-crop' | 'focal-estimated';
export interface PanoWarning { code: PanoWarningCode; frameIndex?: number }

export interface PanoSuccess {
  ok: true;
  width: number;
  height: number;
  /** RGB, 16-bit. */
  data: Uint16Array;
  sourceBits: 8 | 16;
  projection: 'cylindrical';
  focalPx: number;
  focalSource: 'camera' | 'estimated';
  referenceIndex: number;
  placements: FramePlacement[];
  /** Per frame, per channel gain that was applied (1 when exposure matching is off). */
  gains: Array<[number, number, number]>;
  /** The honest crop inside the full stitched outline. */
  crop: { x: number; y: number; width: number; height: number; fullWidth: number; fullHeight: number };
  /** Cylinder coordinates (full-size pixels, reference frame centre = 0,0) of output pixel (0,0). */
  origin: { u: number; v: number };
  /** Mean absolute difference between overlapping frames after placement and gain, 0..1 of full scale. */
  seamMismatch: number;
  settings: { feather: number; workEdge: number; matchExposure: boolean };
  warnings: PanoWarning[];
}

export type PanoRefusalReason = 'too-few' | 'too-many' | 'size-mismatch' | 'too-flat' | 'unrelated' | 'ambiguous'
  | 'vertical' | 'too-large' | 'no-coverage';
export interface PanoRefusal { ok: false; reason: PanoRefusalReason; frameNumber?: number }
export type PanoResult = PanoSuccess | PanoRefusal;

// ---------------------------------------------------------------------------------------------------------------
// Working copies and features

interface Grey { width: number; height: number; data: Float32Array }

/** Box-averaged luminance at scale `k` (≤ 1). */
export function workingGrey(source: PanoSource, k: number): Grey {
  const width = Math.max(8, Math.round(source.width * k)), height = Math.max(8, Math.round(source.height * k));
  const out = new Float32Array(width * height);
  const sx = source.width / width, sy = source.height / height;
  const max = source.bits === 16 ? 65535 : 255;
  const d = source.data;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(source.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(source.width, Math.floor((x + 1) * sx)));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let p = (yy * source.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, p += 4) { sum += 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]; n++; }
      }
      out[y * width + x] = sum / (n * max);
    }
  }
  return { width, height, data: out };
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * r + 1);
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

export interface Feature { x: number; y: number; d: Float32Array }

const DESC_STEP = 3;      // working pixels between descriptor samples
const DESC_SIDE = 8;      // 8×8 samples
const DESC_HALF = (DESC_SIDE - 1) * DESC_STEP / 2;
const MARGIN = Math.ceil(DESC_HALF) + 3;

/** Harris corners spread over a grid, each with a mean/contrast-normalised patch descriptor. */
export function findFeatures(grey: Grey, maxFeatures = 700): Feature[] {
  const { width: w, height: h, data } = grey;
  const ixx = new Float32Array(w * h), iyy = new Float32Array(w * h), ixy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = (data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1]) - (data[i - w - 1] + 2 * data[i - 1] + data[i + w - 1]);
    const gy = (data[i + w - 1] + 2 * data[i + w] + data[i + w + 1]) - (data[i - w - 1] + 2 * data[i - w] + data[i - w + 1]);
    ixx[i] = gx * gx; iyy[i] = gy * gy; ixy[i] = gx * gy;
  }
  const sxx = boxBlur(ixx, w, h, 2), syy = boxBlur(iyy, w, h, 2), sxy = boxBlur(ixy, w, h, 2);
  const response = new Float32Array(w * h);
  let peak = 0;
  for (let i = 0; i < w * h; i++) {
    const det = sxx[i] * syy[i] - sxy[i] * sxy[i], tr = sxx[i] + syy[i];
    const r = det - 0.04 * tr * tr;
    response[i] = r;
    if (r > peak) peak = r;
  }
  if (peak <= 1e-9) return [];
  const floor = Math.max(peak * 0.002, 1e-7);
  const smooth = boxBlur(data, w, h, 1);
  const cellsX = 8, cellsY = 6, perCell = Math.max(4, Math.ceil(maxFeatures / (cellsX * cellsY)));
  const cells: Array<Array<{ x: number; y: number; r: number }>> = Array.from({ length: cellsX * cellsY }, () => []);
  for (let y = MARGIN; y < h - MARGIN; y++) for (let x = MARGIN; x < w - MARGIN; x++) {
    const i = y * w + x, r = response[i];
    if (r < floor) continue;
    let isMax = true;
    for (let dy = -2; dy <= 2 && isMax; dy++) for (let dx = -2; dx <= 2; dx++) {
      if ((dx || dy) && response[i + dy * w + dx] >= r) { isMax = false; break; }
    }
    if (!isMax) continue;
    cells[Math.min(cellsY - 1, Math.floor(y * cellsY / h)) * cellsX + Math.min(cellsX - 1, Math.floor(x * cellsX / w))].push({ x, y, r });
  }
  const out: Feature[] = [];
  for (const cell of cells) {
    cell.sort((a, b) => b.r - a.r);
    for (const c of cell.slice(0, perCell)) {
      const d = new Float32Array(DESC_SIDE * DESC_SIDE);
      let mean = 0;
      for (let j = 0; j < DESC_SIDE; j++) for (let i = 0; i < DESC_SIDE; i++) {
        const v = smooth[Math.round(c.y - DESC_HALF + j * DESC_STEP) * w + Math.round(c.x - DESC_HALF + i * DESC_STEP)];
        d[j * DESC_SIDE + i] = v; mean += v;
      }
      mean /= d.length;
      let sq = 0;
      for (let k = 0; k < d.length; k++) { d[k] -= mean; sq += d[k] * d[k]; }
      const sd = Math.sqrt(sq / d.length);
      if (sd < 0.004) continue;
      for (let k = 0; k < d.length; k++) d[k] /= sd;
      out.push({ x: c.x, y: c.y, d });
    }
  }
  return out;
}

function dist2(a: Float32Array, b: Float32Array, limit: number): number {
  let s = 0;
  for (let k = 0; k < a.length; k++) { const t = a[k] - b[k]; s += t * t; if (s > limit) return s; }
  return s;
}

/** Pairs [index in a, index in b]: nearest neighbour, ratio test, mutual. */
export function matchFeatures(a: readonly Feature[], b: readonly Feature[], ratio = 0.8): Array<[number, number]> {
  const best = (from: readonly Feature[], to: readonly Feature[]) => from.map((f) => {
    let d1 = Infinity, d2 = Infinity, j1 = -1;
    for (let j = 0; j < to.length; j++) {
      const d = dist2(f.d, to[j].d, d2);
      if (d < d1) { d2 = d1; d1 = d; j1 = j; } else if (d < d2) d2 = d;
    }
    return { j: j1, ok: j1 >= 0 && d1 < ratio * ratio * d2 };
  });
  const ab = best(a, b), ba = best(b, a);
  const out: Array<[number, number]> = [];
  ab.forEach((m, i) => { if (m.ok && ba[m.j]?.j === i) out.push([i, m.j]); });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Cylinder geometry and rigid moves

/** A rigid move on the cylinder: p' = R(θ)·p + t. */
export interface Rigid { c: number; s: number; tx: number; ty: number }
const IDENTITY: Rigid = { c: 1, s: 0, tx: 0, ty: 0 };
const apply = (m: Rigid, x: number, y: number): [number, number] => [m.c * x - m.s * y + m.tx, m.s * x + m.c * y + m.ty];
const compose = (a: Rigid, b: Rigid): Rigid => ({ // a ∘ b
  c: a.c * b.c - a.s * b.s, s: a.s * b.c + a.c * b.s,
  tx: a.c * b.tx - a.s * b.ty + a.tx, ty: a.s * b.tx + a.c * b.ty + a.ty,
});
const invert = (m: Rigid): Rigid => ({ c: m.c, s: -m.s, tx: -(m.c * m.tx + m.s * m.ty), ty: -(-m.s * m.tx + m.c * m.ty) });

/** Centred image coordinates → cylinder coordinates at focal f. */
export function toCylinder(x: number, y: number, f: number): [number, number] {
  return [f * Math.atan2(x, f), f * y / Math.hypot(x, f)];
}
/** Cylinder coordinates → centred image coordinates; null behind the camera. */
export function fromCylinder(u: number, v: number, f: number): [number, number] | null {
  const a = u / f;
  if (Math.abs(a) >= Math.PI / 2 - 1e-6) return null;
  const c = Math.cos(a);
  return [f * Math.tan(a), v / c];
}

function fitRigid(pa: ReadonlyArray<[number, number]>, pb: ReadonlyArray<[number, number]>, idx: readonly number[]): Rigid {
  // Least-squares rotation + translation mapping pb → pa (Procrustes without scale).
  let ax = 0, ay = 0, bx = 0, by = 0;
  for (const i of idx) { ax += pa[i][0]; ay += pa[i][1]; bx += pb[i][0]; by += pb[i][1]; }
  const n = idx.length;
  ax /= n; ay /= n; bx /= n; by /= n;
  let sc = 0, ss = 0;
  for (const i of idx) {
    const qx = pb[i][0] - bx, qy = pb[i][1] - by, rx = pa[i][0] - ax, ry = pa[i][1] - ay;
    sc += qx * rx + qy * ry; ss += qx * ry - qy * rx;
  }
  const norm = Math.hypot(sc, ss) || 1;
  const c = sc / norm, s = ss / norm;
  return { c, s, tx: ax - (c * bx - s * by), ty: ay - (s * bx + c * by) };
}

interface PairFit { move: Rigid; inliers: number[]; cost: number; runnerUp: number }

/** RANSAC on a shift (one match a hypothesis), refined to a rigid move. `runnerUp` is the best hypothesis elsewhere. */
function fitPair(pa: ReadonlyArray<[number, number]>, pb: ReadonlyArray<[number, number]>, threshold: number): PairFit {
  const n = pa.length;
  const t2 = threshold * threshold;
  let bestCount = 0, bestShift: [number, number] = [0, 0];
  const counts: Array<{ shift: [number, number]; count: number }> = [];
  for (let h = 0; h < n; h++) {
    const dx = pa[h][0] - pb[h][0], dy = pa[h][1] - pb[h][1];
    let count = 0;
    for (let i = 0; i < n; i++) {
      const ex = pb[i][0] + dx - pa[i][0], ey = pb[i][1] + dy - pa[i][1];
      if (ex * ex + ey * ey < t2 * 4) count++;
    }
    counts.push({ shift: [dx, dy], count });
    if (count > bestCount) { bestCount = count; bestShift = [dx, dy]; }
  }
  let runnerUp = 0;
  const apart = Math.max(8, threshold * 6);
  for (const c of counts) if (Math.hypot(c.shift[0] - bestShift[0], c.shift[1] - bestShift[1]) > apart) runnerUp = Math.max(runnerUp, c.count);
  let inliers: number[] = [];
  for (let i = 0; i < n; i++) {
    const ex = pb[i][0] + bestShift[0] - pa[i][0], ey = pb[i][1] + bestShift[1] - pa[i][1];
    if (ex * ex + ey * ey < t2 * 4) inliers.push(i);
  }
  let move: Rigid = { ...IDENTITY, tx: bestShift[0], ty: bestShift[1] };
  for (let round = 0; round < 4 && inliers.length >= 2; round++) {
    move = fitRigid(pa, pb, inliers);
    const next: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = apply(move, pb[i][0], pb[i][1]);
      if ((x - pa[i][0]) ** 2 + (y - pa[i][1]) ** 2 < t2) next.push(i);
    }
    if (next.length < 2) break;
    inliers = next;
  }
  let cost = 0;
  for (let i = 0; i < n; i++) {
    const [x, y] = apply(move, pb[i][0], pb[i][1]);
    cost += Math.min(t2, (x - pa[i][0]) ** 2 + (y - pa[i][1]) ** 2);
  }
  return { move, inliers, cost, runnerUp };
}

// ---------------------------------------------------------------------------------------------------------------
// Honest crop

/** Largest axis-aligned rectangle of `true` cells (row-major), by the histogram method. */
export function largestRectangle(cells: Uint8Array, cols: number, rows: number): { x: number; y: number; width: number; height: number } {
  const heights = new Int32Array(cols);
  let best = { x: 0, y: 0, width: 0, height: 0 }, bestArea = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) heights[c] = cells[r * cols + c] ? heights[c] + 1 : 0;
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const hgt = c === cols ? 0 : heights[c];
      while (stack.length && heights[stack[stack.length - 1]] >= hgt) {
        const top = stack.pop()!;
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const area = heights[top] * (c - left);
        if (area > bestArea) { bestArea = area; best = { x: left, y: r - heights[top] + 1, width: c - left, height: heights[top] }; }
      }
      stack.push(c);
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------

const yieldNow = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Stitch overlapping frames, in shooting order (left to right or right to left), into one cylindrical panorama. */
export async function stitchPanorama(sources: readonly PanoSource[], options: PanoOptions = {}): Promise<PanoResult> {
  const { signal, onProgress } = options;
  const workEdge = Math.round(Math.min(1600, Math.max(240, options.workEdge ?? 800)));
  const feather = Math.min(0.5, Math.max(0.02, options.feather ?? 0.15));
  const matchExposure = options.matchExposure ?? true;
  const maxOutputPixels = options.maxOutputPixels ?? 120_000_000;
  const n = sources.length;
  if (n < MIN_PANO_FRAMES) return { ok: false, reason: 'too-few' };
  if (n > MAX_PANO_FRAMES) return { ok: false, reason: 'too-many' };
  const W = sources[0].width, H = sources[0].height;
  for (let i = 0; i < n; i++) {
    const s = sources[i];
    if (s.width !== W || s.height !== H || s.data.length !== W * H * 4 || s.bits !== sources[0].bits) return { ok: false, reason: 'size-mismatch', frameNumber: i + 1 };
  }
  const sourceBits = sources[0].bits;
  const total = n * 2 + 4;
  let done = 0;
  const step = (stage: PanoStage) => { done++; onProgress?.(Math.min(done, total), total, stage); };

  // 1. Features at working scale.
  const k = Math.min(1, workEdge / Math.max(W, H));
  const features: Feature[][] = [];
  let ww = 0, wh = 0;
  for (let i = 0; i < n; i++) {
    signal?.throwIfAborted();
    const grey = workingGrey(sources[i], k);
    ww = grey.width; wh = grey.height;
    const found = findFeatures(grey);
    if (found.length < 20) return { ok: false, reason: 'too-flat', frameNumber: i + 1 };
    features.push(found);
    step('matching');
    await yieldNow();
  }
  const cx = (ww - 1) / 2, cy = (wh - 1) / 2;
  // Working scale in each direction (the working copy is rounded).
  const kx = ww / W, ky = wh / H;

  // 2. Matches between neighbours (centred working coordinates).
  const pairs: Array<{ a: Array<[number, number]>; b: Array<[number, number]> }> = [];
  for (let i = 1; i < n; i++) {
    signal?.throwIfAborted();
    const m = matchFeatures(features[i - 1], features[i]);
    if (m.length < 12) return { ok: false, reason: 'unrelated', frameNumber: i + 1 };
    pairs.push({
      a: m.map(([p]) => [features[i - 1][p].x - cx, features[i - 1][p].y - cy]),
      b: m.map(([, q]) => [features[i][q].x - cx, features[i][q].y - cy]),
    });
    step('matching');
    await yieldNow();
  }

  // 3. Focal length: the camera's, or the one that makes every pair agree best.
  const threshold = 1.5;
  const fitAll = (fw: number) => pairs.map((p) => fitPair(p.a.map(([x, y]) => toCylinder(x, y, fw)), p.b.map(([x, y]) => toCylinder(x, y, fw)), threshold));
  const costOf = (fits: PairFit[]) => fits.reduce((sum, f) => sum + f.cost, 0);
  let fw: number;
  let focalSource: PanoSuccess['focalSource'];
  if (options.focalPx && Number.isFinite(options.focalPx) && options.focalPx > 0) {
    fw = options.focalPx * kx;
    focalSource = 'camera';
  } else {
    focalSource = 'estimated';
    let bestF = ww, bestCost = Infinity;
    const lo = Math.log(ww * 0.45), hi = Math.log(ww * 5);
    for (let s = 0; s <= 24; s++) {
      const f = Math.exp(lo + (hi - lo) * s / 24);
      const c = costOf(fitAll(f));
      if (c < bestCost - 1e-9) { bestCost = c; bestF = f; }
    }
    // Golden-section refinement around the best grid step.
    let a = bestF / Math.exp((hi - lo) / 24), b = bestF * Math.exp((hi - lo) / 24);
    const g = (Math.sqrt(5) - 1) / 2;
    let x1 = b - g * (b - a), x2 = a + g * (b - a);
    let c1 = costOf(fitAll(x1)), c2 = costOf(fitAll(x2));
    for (let it = 0; it < 14; it++) {
      if (c1 < c2) { b = x2; x2 = x1; c2 = c1; x1 = b - g * (b - a); c1 = costOf(fitAll(x1)); }
      else { a = x1; x1 = x2; c1 = c2; x2 = a + g * (b - a); c2 = costOf(fitAll(x2)); }
    }
    fw = (a + b) / 2;
    if (costOf(fitAll(fw)) > bestCost) fw = bestF;
  }
  const fits = fitAll(fw);
  step('placing');
  for (let i = 0; i < fits.length; i++) {
    const fit = fits[i], frameNumber = i + 2;
    if (fit.inliers.length < 10 || fit.inliers.length < pairs[i].a.length * 0.2) return { ok: false, reason: 'unrelated', frameNumber };
    if (fit.runnerUp > fit.inliers.length * 0.6) return { ok: false, reason: 'ambiguous', frameNumber };
    if (Math.abs(Math.atan2(fit.move.s, fit.move.c)) > (8 * Math.PI) / 180) return { ok: false, reason: 'ambiguous', frameNumber };
    if (Math.abs(fit.move.ty) > Math.abs(fit.move.tx)) return { ok: false, reason: 'vertical', frameNumber };
  }

  // 4. Placement relative to the middle frame, in full-size pixels. move_i maps frame i's cylinder into frame i-1's.
  const toFull = (m: Rigid): Rigid => ({ c: m.c, s: m.s, tx: m.tx / kx, ty: m.ty / ky });
  const f = fw / kx;
  const ref = Math.floor((n - 1) / 2);
  const toRef: Rigid[] = new Array(n);
  toRef[ref] = IDENTITY;
  for (let i = ref + 1; i < n; i++) toRef[i] = compose(toRef[i - 1], toFull(fits[i - 1].move));
  for (let i = ref - 1; i >= 0; i--) toRef[i] = compose(toRef[i + 1], invert(toFull(fits[i].move)));
  const fromRef = toRef.map(invert);
  const fcx = (W - 1) / 2, fcy = (H - 1) / 2;

  // Outline of each frame on the panorama.
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  const uRange: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    let a0 = Infinity, a1 = -Infinity;
    const edge = (x: number, y: number) => {
      const [u, v] = apply(toRef[i], ...toCylinder(x - fcx, y - fcy, f));
      a0 = Math.min(a0, u); a1 = Math.max(a1, u);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    };
    for (let s = 0; s <= 64; s++) {
      const t = s / 64;
      edge(t * (W - 1), 0); edge(t * (W - 1), H - 1); edge(0, t * (H - 1)); edge(W - 1, t * (H - 1));
    }
    uRange.push([a0 - 1, a1 + 1]);
  }
  const fullWidth = Math.ceil(u1 - u0) + 1, fullHeight = Math.ceil(v1 - v0) + 1;
  if (!Number.isSafeInteger(fullWidth * fullHeight) || fullWidth * fullHeight > maxOutputPixels * 4) return { ok: false, reason: 'too-large' };

  /** Where cylinder point (u, v) falls in frame i (full-size pixel coordinates), or null outside it. */
  const inFrame = (i: number, u: number, v: number): [number, number] | null => {
    const [cu, cv] = apply(fromRef[i], u, v);
    const p = fromCylinder(cu, cv, f);
    if (!p) return null;
    const x = p[0] + fcx, y = p[1] + fcy;
    return x >= 0 && y >= 0 && x <= W - 1 && y <= H - 1 ? [x, y] : null;
  };

  // 5. Coverage on a coarse grid and the largest fully covered rectangle.
  const cell = Math.max(1, Math.ceil(Math.sqrt((fullWidth * fullHeight) / 1_500_000)));
  const cols = Math.ceil(fullWidth / cell), rows = Math.ceil(fullHeight / cell);
  const node = new Uint8Array((cols + 1) * (rows + 1));
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    const u = u0 + Math.min(c * cell, fullWidth - 1), v = v0 + Math.min(r * cell, fullHeight - 1);
    for (let i = 0; i < n; i++) {
      if (u < uRange[i][0] || u > uRange[i][1]) continue;
      if (inFrame(i, u, v)) { node[r * (cols + 1) + c] = 1; break; }
    }
  }
  const covered = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c;
    covered[r * cols + c] = node[a] & node[a + 1] & node[a + cols + 1] & node[a + cols + 2];
  }
  // One cell in from the edge of the covered area: the outline between grid points is curved.
  const eroded = new Uint8Array(cols * rows);
  for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
    const i = r * cols + c;
    eroded[i] = covered[i] & covered[i - 1] & covered[i + 1] & covered[i - cols] & covered[i + cols];
  }
  const rect = largestRectangle(eroded, cols, rows);
  if (rect.width < 2 || rect.height < 2) return { ok: false, reason: 'no-coverage' };
  const crop = {
    x: rect.x * cell, y: rect.y * cell,
    width: Math.min(fullWidth - rect.x * cell, rect.width * cell), height: Math.min(fullHeight - rect.y * cell, rect.height * cell),
    fullWidth, fullHeight,
  };
  if (crop.width * crop.height > maxOutputPixels) return { ok: false, reason: 'too-large' };
  const origin = { u: u0 + crop.x, v: v0 + crop.y };
  step('placing');
  await yieldNow();

  // 6. Exposure: per-channel means over each neighbour overlap → gain relative to the reference frame.
  const max = sourceBits === 16 ? 65535 : 255;
  const sample = (i: number, x: number, y: number, out: Float64Array) => {
    const d = sources[i].data;
    const xi = Math.min(W - 2, Math.floor(x)), yi = Math.min(H - 2, Math.floor(y));
    const fx = x - xi, fy = y - yi;
    const p = (yi * W + xi) * 4, q = p + W * 4;
    for (let ch = 0; ch < 3; ch++) {
      const top = d[p + ch] + (d[p + 4 + ch] - d[p + ch]) * fx;
      const bottom = d[q + ch] + (d[q + 4 + ch] - d[q + ch]) * fx;
      out[ch] = top + (bottom - top) * fy;
    }
  };
  const gains: Array<[number, number, number]> = Array.from({ length: n }, () => [1, 1, 1]);
  const warnings: PanoWarning[] = [];
  const pa = new Float64Array(3), pb = new Float64Array(3);
  const overlapStats = (i: number, j: number, gi: readonly number[], gj: readonly number[]) => {
    const sa = [0, 0, 0], sb = [0, 0, 0];
    let diff = 0, count = 0;
    const lo = Math.max(uRange[i][0], uRange[j][0]), hi = Math.min(uRange[i][1], uRange[j][1]);
    if (hi <= lo) return { sa, sb, diff: 0, count: 0 };
    const stepU = Math.max(1, (hi - lo) / 80), stepV = Math.max(1, (v1 - v0) / 80);
    for (let v = v0; v <= v1; v += stepV) for (let u = lo; u <= hi; u += stepU) {
      const a = inFrame(i, u, v), b = inFrame(j, u, v);
      if (!a || !b) continue;
      sample(i, a[0], a[1], pa); sample(j, b[0], b[1], pb);
      for (let ch = 0; ch < 3; ch++) {
        sa[ch] += pa[ch]; sb[ch] += pb[ch];
        diff += Math.abs(pa[ch] * gi[ch] - pb[ch] * gj[ch]) / max;
      }
      count++;
    }
    return { sa, sb, diff: diff / Math.max(1, count * 3), count };
  };
  if (matchExposure) {
    const ratio: Array<[number, number, number]> = Array.from({ length: n }, () => [1, 1, 1]); // gain of i relative to i-1
    for (let i = 1; i < n; i++) {
      const { sa, sb, count } = overlapStats(i - 1, i, [1, 1, 1], [1, 1, 1]);
      if (!count) continue;
      for (let ch = 0; ch < 3; ch++) ratio[i][ch] = sb[ch] > 1e-6 && sa[ch] > 1e-6 ? sa[ch] / sb[ch] : 1;
    }
    for (let i = ref + 1; i < n; i++) for (let ch = 0; ch < 3; ch++) gains[i][ch] = gains[i - 1][ch] * ratio[i][ch];
    for (let i = ref - 1; i >= 0; i--) for (let ch = 0; ch < 3; ch++) gains[i][ch] = gains[i + 1][ch] / ratio[i + 1][ch];
    for (let i = 0; i < n; i++) {
      for (let ch = 0; ch < 3; ch++) gains[i][ch] = Math.min(2, Math.max(0.5, gains[i][ch]));
      if (gains[i].some((g) => Math.abs(Math.log2(g)) > 0.5)) warnings.push({ code: 'exposure-differs', frameIndex: i });
    }
  }
  let seamSum = 0, seamCount = 0;
  for (let i = 1; i < n; i++) {
    const s = overlapStats(i - 1, i, gains[i - 1], gains[i]);
    seamSum += s.diff * s.count; seamCount += s.count;
  }
  const seamMismatch = seamCount ? seamSum / seamCount : 0;
  if (seamMismatch > 0.06) warnings.push({ code: 'seams-visible' });
  if (focalSource === 'estimated') warnings.push({ code: 'focal-estimated' });
  const kept = (crop.width * crop.height) / (fullWidth * fullHeight);
  if (kept < 0.6) warnings.push({ code: 'large-crop' });
  step('placing');

  // 7. Blend, row by row, gathering from every frame that covers each pixel.
  const out = new Uint16Array(crop.width * crop.height * 3);
  const featherPx = Math.max(2, feather * Math.min(W, H));
  const scaleOut = 65535 / max;
  const acc = new Float64Array(3);
  let uncovered = 0;
  const band = Math.max(1, Math.floor(200_000 / crop.width));
  for (let y = 0; y < crop.height; y++) {
    if (y % band === 0) {
      signal?.throwIfAborted();
      onProgress?.(done + Math.floor((y / crop.height) * 3), total, 'blending');
      await yieldNow();
      signal?.throwIfAborted();
    }
    const v = origin.v + y;
    for (let x = 0; x < crop.width; x++) {
      const u = origin.u + x;
      acc[0] = acc[1] = acc[2] = 0;
      let wsum = 0;
      for (let i = 0; i < n; i++) {
        if (u < uRange[i][0] || u > uRange[i][1]) continue;
        const p = inFrame(i, u, v);
        if (!p) continue;
        const edge = Math.min(p[0], W - 1 - p[0], p[1], H - 1 - p[1]);
        const w = Math.min(1, (edge + 1e-3) / featherPx);
        sample(i, p[0], p[1], pa);
        const g = gains[i];
        acc[0] += pa[0] * g[0] * w; acc[1] += pa[1] * g[1] * w; acc[2] += pa[2] * g[2] * w;
        wsum += w;
      }
      const o = (y * crop.width + x) * 3;
      if (wsum <= 0) { uncovered++; continue; }
      for (let ch = 0; ch < 3; ch++) out[o + ch] = Math.max(0, Math.min(65535, Math.round((acc[ch] / wsum) * scaleOut)));
    }
  }
  signal?.throwIfAborted();
  // Never fill: a pixel no real frame covered means the crop was wrong, so nothing is returned.
  if (uncovered > 0) return { ok: false, reason: 'no-coverage' };
  done = total;
  onProgress?.(total, total, 'blending');

  const r = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;
  return {
    ok: true, width: crop.width, height: crop.height, data: out, sourceBits, projection: 'cylindrical',
    focalPx: r(f, 2), focalSource, referenceIndex: ref,
    placements: toRef.map((m, i) => ({
      du: r(m.tx, 2), dv: r(m.ty, 2), rotationDegrees: r((Math.atan2(m.s, m.c) * 180) / Math.PI, 3),
      inliers: i === 0 ? 0 : fits[i - 1].inliers.length, matches: i === 0 ? 0 : pairs[i - 1].a.length,
    })),
    gains: gains.map((g) => [r(g[0], 4), r(g[1], 4), r(g[2], 4)]),
    crop, origin: { u: r(origin.u, 3), v: r(origin.v, 3) }, seamMismatch: r(seamMismatch, 5),
    settings: { feather, workEdge, matchExposure }, warnings,
  };
}

/** Focal length in full-size pixels from the camera's 35 mm equivalent (36 mm across the long edge). Null when unknown. */
export function focalPxFrom35mm(focal35mm: number | undefined | null, width: number, height: number): number | null {
  if (!focal35mm || !Number.isFinite(focal35mm) || focal35mm < 4 || focal35mm > 2000) return null;
  return (focal35mm / 36) * Math.max(width, height);
}
