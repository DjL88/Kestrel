/** Diagnostic only: no photo writes, no colour-truth claims without an ICC-verified input.
 * Each sample is a pair of neighbouring RGB16 pixels straddling a mask edge,
 * before and after a local edit. Values are display-encoded sRGB16.
 */
import { decodeSrgb16 } from './linearRgb16';
export interface BoundaryPair16 {
  beforeInside: readonly [number, number, number];
  beforeOutside: readonly [number, number, number];
  afterInside: readonly [number, number, number];
  afterOutside: readonly [number, number, number];
}
export interface BoundaryMetrics16 {
  samples: number;
  meanExcessLuminanceJump: number;
  maxExcessLuminanceJump: number;
  meanExcessChromaJump: number;
  maxExcessChromaJump: number;
  /** A diagnostic, not a subjective quality score or verified halo classification. */
  largeDiscontinuityFraction: number;
}
function rgb(sample: readonly number[]): [number, number, number] {
  if (sample.length !== 3 || sample.some(v => !Number.isInteger(v) || v < 0 || v > 65535)) {
    throw new RangeError('Boundary evidence must contain valid 16-bit sRGB channels.');
  }
  return [decodeSrgb16(sample[0]), decodeSrgb16(sample[1]), decodeSrgb16(sample[2])];
}
const luminance = (v: readonly number[]) => v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
function chromaDistance(a: readonly number[], b: readonly number[]): number {
  const ya = luminance(a), yb = luminance(b);
  return Math.hypot((a[0] - ya) - (b[0] - yb), (a[2] - ya) - (b[2] - yb));
}
export function measureMaskBoundary16(pairs: readonly BoundaryPair16[], threshold = 0.08): BoundaryMetrics16 {
  if (!pairs.length || pairs.length > 2_000_000 || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError('Boundary evidence count or threshold is invalid.');
  }
  let sumL = 0, maxL = 0, sumC = 0, maxC = 0, large = 0;
  for (const pair of pairs) {
    const bi = rgb(pair.beforeInside), bo = rgb(pair.beforeOutside);
    const ai = rgb(pair.afterInside), ao = rgb(pair.afterOutside);
    // Excess discontinuity relative to the source edge, not absolute contrast:
    // real dark bird against bright sky must not be mistaken for a new halo.
    const l = Math.max(0, Math.abs(luminance(ai) - luminance(ao)) - Math.abs(luminance(bi) - luminance(bo)));
    const c = Math.max(0, chromaDistance(ai, ao) - chromaDistance(bi, bo));
    sumL += l; sumC += c;
    maxL = Math.max(maxL, l); maxC = Math.max(maxC, c);
    if (Math.max(l, c) > threshold) large++;
  }
  return {
    samples: pairs.length,
    meanExcessLuminanceJump: sumL / pairs.length,
    maxExcessLuminanceJump: maxL,
    meanExcessChromaJump: sumC / pairs.length,
    maxExcessChromaJump: maxC,
    largeDiscontinuityFraction: large / pairs.length,
  };
}

/** Full-frame, bounded-memory diagnostic of newly introduced discontinuities.
 * Compare four-connected neighbours across a hard 0.5 crossing OR a meaningful
 * gradient in the partially covered feather ring. A soft mask can create a
 * visible fringe without any adjacent samples crossing 0.5.
 * Source and output must have identical framing and verified sRGB16 profiles.
 * No intermediate image or unbounded list of boundary pairs is allocated.
 */
export function measureFullFrameMaskBoundary16(
  before: Uint16Array, after: Uint16Array, alpha: Float32Array,
  width: number, height: number, threshold = 0.08,
): BoundaryMetrics16 {
  const pixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || pixels > 80_000_000 ||
      alpha.length !== pixels || before.length !== pixels * 3 ||
      after.length !== pixels * 3 || !Number.isFinite(threshold) ||
      threshold < 0 || threshold > 1)
    throw new RangeError('Invalid full-resolution mask evidence geometry.');
  const sample = (buf: Uint16Array, p: number): [number, number, number] => {
    const i = p * 3;
    return [decodeSrgb16(buf[i]), decodeSrgb16(buf[i + 1]), decodeSrgb16(buf[i + 2])];
  };
  let count = 0, sumL = 0, sumC = 0, maxL = 0, maxC = 0, large = 0;
  const compare = (p: number, q: number) => {
    const ap = alpha[p], aq = alpha[q];
    const crossesMidpoint = (ap < 0.5) !== (aq < 0.5);
    const featherGradient = Math.abs(ap - aq) >= 0.125 &&
      ((ap > 0 && ap < 1) || (aq > 0 && aq < 1));
    if (!crossesMidpoint && !featherGradient) return;
    const bi = sample(before, p), bo = sample(before, q);
    const ai = sample(after, p), ao = sample(after, q);
    const l = Math.max(0, Math.abs(luminance(ai) - luminance(ao)) - Math.abs(luminance(bi) - luminance(bo)));
    const c = Math.max(0, chromaDistance(ai, ao) - chromaDistance(bi, bo));
    count++; sumL += l; sumC += c;
    maxL = Math.max(maxL, l); maxC = Math.max(maxC, c);
    if (Math.max(l, c) > threshold) large++;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x, a = alpha[p];
    if (!Number.isFinite(a) || a < 0 || a > 1) throw new RangeError('Invalid mask coverage.');
    if (x + 1 < width) compare(p, p + 1);
    if (y + 1 < height) compare(p, p + width);
  }
  return {
    samples: count, meanExcessLuminanceJump: count ? sumL / count : 0,
    maxExcessLuminanceJump: maxL, meanExcessChromaJump: count ? sumC / count : 0,
    maxExcessChromaJump: maxC, largeDiscontinuityFraction: count ? large / count : 0,
  };
}
