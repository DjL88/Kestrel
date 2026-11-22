/**
 * InFlight TrueDetail research kernel for high-precision scene-linear RGB.
 *
 * Unlike the 8-bit preview prototype, this preserves signed/floating pixel values
 * (including highlight values above 1) and never converts to JPEG or 8-bit RGB.
 * Input is an interleaved Float32Array of linear R,G,B values. This is only
 * chroma reduction AFTER demosaicing; joint RAW demosaic/denoise remains research.
 * Original data is never mutated. Not production-ready or DxO-equivalent.
 */
export interface LinearChromaOptions {
  strength?: number;
  radius?: 1 | 2;
}
const lum = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

export function denoiseChromaLinearRGB(
  source: Float32Array,
  width: number,
  height: number,
  options: LinearChromaOptions = {},
): Float32Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > 100_000 || height > 100_000 || width * height > 80_000_000 ||
      source.length !== width * height * 3) {
    throw new RangeError('Invalid scene-linear RGB dimensions or buffer.');
  }
  const strength = options.strength ?? 0.6;
  const radius = options.radius ?? 1;
  if (!Number.isFinite(strength) || strength < 0 || strength > 1 || (radius !== 1 && radius !== 2)) {
    throw new RangeError('Denoise strength must be 0–1 and radius must be 1 or 2.');
  }
  for (const value of source) {
    if (!Number.isFinite(value)) throw new RangeError('Scene-linear RGB contains a nonfinite value.');
  }
  const result = new Float32Array(source);
  if (strength === 0 || (width === 1 && height === 1)) return result;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const centerY = lum(source[i], source[i + 1], source[i + 2]);
      const centerR = source[i] - centerY;
      const centerB = source[i + 2] - centerY;
      let total = 1;
      let sumR = centerR, sumB = centerB;
      // Adapt edge thresholds to highlights without clipping or compressing HDR.
      const edgeScale = Math.max(1, Math.abs(centerY));
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if ((dx === 0 && dy === 0) || nx < 0 || nx >= width) continue;
          const j = (ny * width + nx) * 3;
          const neighbourY = lum(source[j], source[j + 1], source[j + 2]);
          const lumWeight = Math.max(0, 1 - Math.abs(centerY - neighbourY) / (0.12 * edgeScale));
          if (lumWeight === 0) continue;
          const neighbourR = source[j] - neighbourY;
          const neighbourB = source[j + 2] - neighbourY;
          const chromaDelta = Math.max(Math.abs(neighbourR - centerR), Math.abs(neighbourB - centerB));
          const chromaWeight = Math.max(0, 1 - chromaDelta / (0.28 * edgeScale));
          if (chromaWeight === 0) continue;
          const distanceWeight = dx === 0 || dy === 0 ? 0.75 : 0.5;
          const weight = distanceWeight * lumWeight * lumWeight * chromaWeight;
          sumR += neighbourR * weight;
          sumB += neighbourB * weight;
          total += weight;
        }
      }
      const r = centerY + centerR + strength * (sumR / total - centerR);
      const b = centerY + centerB + strength * (sumB / total - centerB);
      const g = (centerY - 0.2126 * r - 0.0722 * b) / 0.7152;
      result[i] = r;
      result[i + 1] = g;
      result[i + 2] = b;
    }
  }
  return result;
}