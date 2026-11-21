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
