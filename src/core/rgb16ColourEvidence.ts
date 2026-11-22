/** Evidence from InFlight's existing display-encoded sRGB RGB16 working pixels.
 * This is not a sensor-linear colour measurement or a camera-profile calibration.
 * An explicit provenance gate prevents calling unknown/ICC-unverified data accurate.
 * Only existing captured pixels are read. No edits or invented scene data.
 */
export interface Rgb16ColourSource {
  width: number;
  height: number;
  data: Uint16Array;
  /** Must be verified by the caller against the actual input/output profile. */
  colourSpace: 'verified-srgb' | 'unverified';
}
export interface ColourRegion { x: number; y: number; width: number; height: number }
export interface Rgb16RegionEvidence {
  status: 'measured' | 'unknown';
  reason?: string;
  samples: number;
  clippedChannelFraction: number;
  clippedPixelFraction: number;
  meanLinearLuminance: number;
  meanLinearChroma: number;
  /** Hue of mean linear RGB, degrees; null for achromatic regions. Not species truth. */
  meanHueDegrees: number | null;
  /** Average linear RGB channel ratios to green. Not a neutral WB estimate without a reference. */
  redGreenRatio: number | null;
  blueGreenRatio: number | null;
}
const empty = (reason: string): Rgb16RegionEvidence => ({
  status: 'unknown', reason, samples: 0, clippedChannelFraction: 0,
  clippedPixelFraction: 0, meanLinearLuminance: 0, meanLinearChroma: 0,
  meanHueDegrees: null, redGreenRatio: null, blueGreenRatio: null,
});
const linear = (sample: number) => {
  const x = sample / 65535;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const validRegion = (r: ColourRegion, w: number, h: number) =>
  [r.x, r.y, r.width, r.height].every(Number.isSafeInteger) &&
  r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 &&
  r.x + r.width <= w && r.y + r.height <= h;
export function measureRgb16Region(image: Rgb16ColourSource, region: ColourRegion, stride = 1): Rgb16RegionEvidence {
  const { width, height, data } = image;
  if (image.colourSpace !== 'verified-srgb') return empty('ICC/input colour transform has not been verified');
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
      !Number.isSafeInteger(width * height) || width * height > 80_000_000 ||
      !(data instanceof Uint16Array) || data.length !== width * height * 3 ||
      !validRegion(region, width, height) || !Number.isSafeInteger(stride) || stride < 1) {
    return empty('Invalid RGB16 geometry or sampling');
  }
  let n = 0, clipChannels = 0, clipPixels = 0, lum = 0, chroma = 0;
  let red = 0, green = 0, blue = 0;
  for (let y = region.y; y < region.y + region.height; y += stride) {
    for (let x = region.x; x < region.x + region.width; x += stride) {
      const i = (y * width + x) * 3;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const clipped = Number(r === 0 || r === 65535) + Number(g === 0 || g === 65535) + Number(b === 0 || b === 65535);
      clipChannels += clipped;
      if (clipped) clipPixels++;
      const lr = linear(r), lg = linear(g), lb = linear(b);
      red += lr; green += lg; blue += lb;
      lum += 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
      chroma += Math.max(lr, lg, lb) - Math.min(lr, lg, lb);
      n++;
    }
  }
  if (!n) return empty('No pixels sampled');
  const r = red / n, g = green / n, b = blue / n;
  const delta = Math.max(r, g, b) - Math.min(r, g, b);
  let hue: number | null = null;
  if (delta > 1e-8) {
    const max = Math.max(r, g, b);
    const h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue = (h * 60 + 360) % 360;
  }
  return { status: 'measured', samples: n, clippedChannelFraction: clipChannels / (3 * n),
    clippedPixelFraction: clipPixels / n, meanLinearLuminance: lum / n,
    meanLinearChroma: chroma / n, meanHueDegrees: hue,
    redGreenRatio: g > 1e-8 ? r / g : null, blueGreenRatio: g > 1e-8 ? b / g : null };
}
/** Compare the SAME verified colour space and geometry; unknown is not a PASS.
 * Caller must supply matching source/revision/profile provenance separately. */
export function compareRgb16Region(before: Rgb16ColourSource, after: Rgb16ColourSource, region: ColourRegion, stride = 1) {
  if (before.width !== after.width || before.height !== after.height)
    return { status: 'unknown' as const, reason: 'Mismatched image geometry' };
  const a = measureRgb16Region(before, region, stride), b = measureRgb16Region(after, region, stride);
  if (a.status !== 'measured' || b.status !== 'measured')
    return { status: 'unknown' as const, reason: a.reason ?? b.reason };
  return { status: 'measured' as const, samples: a.samples,
    luminanceDelta: b.meanLinearLuminance - a.meanLinearLuminance,
    chromaDelta: b.meanLinearChroma - a.meanLinearChroma,
    clippedPixelFractionDelta: b.clippedPixelFraction - a.clippedPixelFraction,
    before: a, after: b };
}
