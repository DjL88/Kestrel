/**
 * Bounded-memory, non-generative 16-bit chroma-noise reduction for RAW master
 * export. Matches the existing screen filter's luminance/chroma-aware 3x3 / 5x5
 * neighbourhood and slider semantics without quantising to eight bits.
 *
 * This is a conservative baseline, NOT a TrueDetail AI or DxO DeepPRIME claim.
 * It cannot restore lost detail, invent feathers or replace camera-level
 * denoise and demosaic. It changes colour only; local luminance/edge contrast
 * is intentionally held nearly constant.
 *
 * Mutates the caller-owned 16-bit RGB array. Row-banded snapshots with an
 * original-pixel halo avoid allocating a second 45 MP RGB frame; the halo is
 * retained before writes, so subsequent bands never denoise prior output.
 */

const MAX_PIXELS = 80_000_000;
const TARGET_BAND_PIXELS = 220_000;
const luminance16 = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clipped16 = (value: number): number => Math.max(0, Math.min(65535, Math.round(value)));

export function denoiseChromaRgb16(
  pixels: Uint16Array, width: number, height: number, strength: number, radius: 1 | 2,
): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width * height > MAX_PIXELS || pixels.length !== width * height * 3) {
    throw new RangeError('Invalid or unsupported full-resolution 16-bit image dimensions.');
  }
  if (!Number.isFinite(strength) || strength < 0 || strength > 1 || (radius !== 1 && radius !== 2)) {
    throw new RangeError('16-bit noise reduction must have a strength of 0–1 and a 1–2 pixel radius.');
  }
  if (strength === 0 || (width === 1 && height === 1)) return;

  // Never keep a whole-frame output copy. A Nikon Z8 45 MP RGB16 image is
  // already about 270 MiB; only ~220k central pixels and their halo are copied.
  const stride = width * 3;
  const rows = Math.max(1, Math.floor(TARGET_BAND_PIXELS / width));
  let originalTopHalo: Uint16Array | null = null;
  for (let from = 0; from < height; from += rows) {
    const to = Math.min(height, from + rows);
    const first = Math.max(0, from - radius);
    const last = Math.min(height, to + radius);
    const source = pixels.slice(first * stride, last * stride);
    // Top margin was already written in prior band; restore original samples.
    if (originalTopHalo && first < from) source.set(originalTopHalo, 0);
    // Keep unmodified samples for the following band's top margin, BEFORE
    // writing this band's output. Handles even one-row bands at large widths.
    if (to < height) {
      const retainedFrom = Math.max(first, to - radius);
      originalTopHalo = source.slice((retainedFrom - first) * stride, (to - first) * stride);
    } else {
      originalTopHalo = null;
    }

    const luma = new Float32Array(source.length / 3);
    for (let p = 0; p < luma.length; p++) {
      const i = p * 3;
      luma[p] = luminance16(source[i], source[i + 1], source[i + 2]);
    }

    for (let y = from; y < to; y++) {
      for (let x = 0; x < width; x++) {
        const center = (y - first) * width + x;
        const i = center * 3;
        const y0 = luma[center];
        const dr = source[i] - y0;
        const db = source[i + 2] - y0;
        let weightedR = dr, weightedB = db, total = 1;
        for (let dy = -radius; dy <= radius; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const p = (ny - first) * width + nx;
            const neighbourY = luma[p];
            const brightnessSimilarity = Math.max(0, 1 - Math.abs(neighbourY - y0) / (32 * 257));
            if (!brightnessSimilarity) continue;
            const j = p * 3;
            const adjacentR = source[j] - neighbourY;
            const adjacentB = source[j + 2] - neighbourY;
            const chromaDifference = Math.max(Math.abs(adjacentR - dr), Math.abs(adjacentB - db));
            const colourSimilarity = Math.max(0, 1 - chromaDifference / (90 * 257));
            if (!colourSimilarity) continue;
            const weight = (dx === 0 || dy === 0 ? 0.75 : 0.5) *
              brightnessSimilarity ** 2 * colourSimilarity;
            weightedR += adjacentR * weight;
            weightedB += adjacentB * weight;
            total += weight;
          }
        }
        const red = y0 + dr + strength * (weightedR / total - dr);
        const blue = y0 + db + strength * (weightedB / total - db);
        const green = (y0 - 0.2126 * red - 0.0722 * blue) / 0.7152;
        const destination = (y * width + x) * 3;
        pixels[destination] = clipped16(red);
        pixels[destination + 1] = clipped16(green);
        pixels[destination + 2] = clipped16(blue);
      }
    }
  }
}
