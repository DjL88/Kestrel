import { decodeSrgb16 } from './linearRgb16';

/**
 * Measured RGB16 mask-boundary evidence, not a judgement about species colour
 * or a claim of halo-free output. Both images must be in the SAME verified
 * display-encoded sRGB16 profile, framing and dimensions. Do not feed JPEG
 * proof pixels, scene-linear CFA, or unprofiled camera RGB here.
 *
 * Stream through the original and rendered full-resolution buffers; no new
 * frame-sized allocation. Alpha is the final effective mask coverage, including
 * user brush edits and mask intersections, from the exact export geometry.
 */
export interface Rgb16EdgeEvidence {
  transitionPixels: number;
  /** Mean absolute change in linear-light relative luminance within 0<alpha<1. */
  meanBoundaryLuminanceDelta: number | null;
  /** Maximum luminance change within the boundary ring. */
  maxBoundaryLuminanceDelta: number | null;
  /** Mean absolute chroma change in linear-light RGB distance, NOT perceptual ΔE. */
  meanBoundaryChromaDelta: number | null;
  /** Fraction of boundary pixels with a newly clipped channel. */
  newClipFraction: number | null;
  /** Relative luminance delta in the mask interior; contextual comparator. */
  meanInteriorLuminanceDelta: number | null;
  status: 'measured' | 'insufficient-boundary';
}

export function measureRgb16MaskEdge(
  before: Uint16Array,
  after: Uint16Array,
  alpha: Float32Array,
): Rgb16EdgeEvidence {
  if (before.length !== after.length || before.length !== alpha.length * 3 ||
      before.length % 3 !== 0) throw new RangeError('RGB16 edge evidence dimensions disagree.');
  let ring = 0, inside = 0, lumSum = 0, lumMax = 0, chromaSum = 0, clips = 0, interiorSum = 0;
  const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  for (let p = 0; p < alpha.length; p++) {
    const a = alpha[p];
    if (!Number.isFinite(a) || a < 0 || a > 1) throw new RangeError('Invalid mask coverage in edge evidence.');
    if (a === 0) continue;
    const offset = p * 3;
    const original = [decodeSrgb16(before[offset]), decodeSrgb16(before[offset + 1]), decodeSrgb16(before[offset + 2])];
    const rendered = [decodeSrgb16(after[offset]), decodeSrgb16(after[offset + 1]), decodeSrgb16(after[offset + 2])];
    const delta = Math.abs(luminance(...(original as [number,number,number])) - luminance(...(rendered as [number,number,number])));
    if (a === 1) { inside++; interiorSum += delta; continue; }
    ring++; lumSum += delta; lumMax = Math.max(lumMax, delta);
    const chroma = (rgb: number[]) => [rgb[0] - rgb[1], rgb[2] - rgb[1]];
    const c0 = chroma(original), c1 = chroma(rendered);
    chromaSum += Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
    if ([0, 1, 2].some(c => after[offset + c] === 65535 && before[offset + c] < 65535)) clips++;
  }
  return {
    transitionPixels: ring,
    meanBoundaryLuminanceDelta: ring ? lumSum / ring : null,
    maxBoundaryLuminanceDelta: ring ? lumMax : null,
    meanBoundaryChromaDelta: ring ? chromaSum / ring : null,
    newClipFraction: ring ? clips / ring : null,
    meanInteriorLuminanceDelta: inside ? interiorSum / inside : null,
    status: ring ? 'measured' : 'insufficient-boundary',
  };
}
