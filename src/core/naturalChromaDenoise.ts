/**
 * Kite44 TrueDetail research: deterministic, non-generative colour-noise baseline.
 *
 * This is NOT a production RAW/DeepPRIME replacement. It accepts already developed
 * 8-bit RGBA pixels and deliberately leaves luminance/detail alone. No model, network,
 * original-file access, or new dependency. Do not enable in the editor until real
 * RAW comparisons and a faster/colour-managed pipeline are available.
 */
export interface ChromaDenoiseOptions {
  /** Blend between unmodified colour and the filtered colour: 0..1. */
  strength?: number;
  /** Neighbourhood radius in pixels; 1 is suitable for the CPU baseline. */
  radius?: 1 | 2;
}

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const finiteInRange = (value: number, lo: number, hi: number) => Number.isFinite(value) && value >= lo && value <= hi;

/**
 * Reduce chroma noise without averaging luminance or crossing strong colour/brightness edges.
 * The output is a new RGBA buffer; source is never mutated. Transparent pixels are
 * byte-for-byte preserved and never mixed into opaque pixels. The only extra allocation
 * is the output buffer, allowing future region/tile processing with the same kernel.
 */
export function denoiseChromaRGBA(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  options: ChromaDenoiseOptions = {},
): Uint8ClampedArray {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > 100_000 || height > 100_000 || width * height > 80_000_000 ||
      source.length !== width * height * 4) {
    throw new RangeError('Invalid image dimensions or RGBA pixel buffer.');
  }
  const strength = options.strength ?? 0.6;
  const radius = options.radius ?? 1;
  if (!finiteInRange(strength, 0, 1) || (radius !== 1 && radius !== 2)) {
    throw new RangeError('Denoise strength must be 0–1 and radius must be 1 or 2.');
  }

  const result = new Uint8ClampedArray(source);
  if (strength === 0 || (width === 1 && height === 1)) return result;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (source[i + 3] !== 255) continue;
      const centerY = luminance(source[i], source[i + 1], source[i + 2]);
      const centerR = source[i] - centerY;
      const centerB = source[i + 2] - centerY;
      let weightedR = centerR;
      let weightedB = centerB;
      let total = 1;

      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = (ny * width + nx) * 4;
          if (source[j + 3] !== 255) continue;
          const adjacentY = luminance(source[j], source[j + 1], source[j + 2]);
          // A strong brightness boundary must remain sharp (feathers, eyes, lettering).
          const brightnessSimilarity = Math.max(0, 1 - Math.abs(adjacentY - centerY) / 32);
          if (!brightnessSimilarity) continue;
          const r = source[j] - adjacentY;
          const b = source[j + 2] - adjacentY;
          // Isoluminant colour boundaries also need protection, not just luma edges.
          const chromaDifference = Math.max(Math.abs(r - centerR), Math.abs(b - centerB));
          const colourSimilarity = Math.max(0, 1 - chromaDifference / 90);
          if (!colourSimilarity) continue;
          const distanceWeight = dx === 0 || dy === 0 ? 0.75 : 0.5;
          const weight = distanceWeight * brightnessSimilarity ** 2 * colourSimilarity;
          weightedR += r * weight;
          weightedB += b * weight;
          total += weight;
        }
      }

      // Blend colour differences but retain original luminance. This cannot
      // invent texture or recover highlight/shadow data already clipped.
      const red = centerY + centerR + strength * (weightedR / total - centerR);
      const blue = centerY + centerB + strength * (weightedB / total - centerB);
      const green = (centerY - 0.2126 * red - 0.0722 * blue) / 0.7152;
      result[i] = red;
      result[i + 1] = green;
      result[i + 2] = blue;
    }
  }
  return result;
}
