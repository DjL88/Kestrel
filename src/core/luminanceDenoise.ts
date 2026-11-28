import { strengthAt, type DenoiseZones, zoneStrengths, hasDenoiseZones } from './denoiseZones';

/** Conservative, non-generative display-luminance noise reduction.
 * A single normalized kernel serves both preview and RGB16 master. Strong
 * brightness and colour boundaries are excluded; chroma is preserved by
 * applying the same additive correction to every channel, bounded by gamut.
 * Read immutable row halos so a band never filters already modified pixels.
 *
 * `zones` (src/core/denoiseZones.ts) adds strength by tonal zone on top of `strength`: each pixel's strength is the global one
 * plus the zones' strengths weighted smoothly by that pixel's local brightness. Without zones nothing changes.
 */
export function denoiseLuminance(
  pixels: Uint8ClampedArray | Uint16Array, width: number, height: number,
  strength: number, bandPixels = 220_000, zones?: DenoiseZones,
): void {
  const stride = pixels instanceof Uint16Array ? 3 : 4;
  const max = stride === 3 ? 65535 : 255;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width * height > 80_000_000 ||
      pixels.length !== width * height * stride ||
      !Number.isFinite(strength) || strength < 0 || strength > 1 ||
      !Number.isSafeInteger(bandPixels) || bandPixels < 1) {
    throw new RangeError('Invalid luminance denoise input.');
  }
  const zoned = hasDenoiseZones(zones);
  const zoneRaw = zoned ? zoneStrengths(zones) : [];
  const scratch = new Float32Array(5);
  if (!strength && !zoned) return;
  const widest = zoned ? Math.min(1, strength + Math.max(...zoneRaw) / 2) : strength;
  const radius = widest > 0.5 ? 2 : 1;
  const rowStride = width * stride;
  const rows = Math.max(1, Math.floor(bandPixels / width));
  let retained: typeof pixels | undefined;
  for (let from = 0; from < height; from += rows) {
    const to = Math.min(height, from + rows);
    const first = Math.max(0, from - radius), last = Math.min(height, to + radius);
    const source = pixels.slice(first * rowStride, last * rowStride);
    if (retained) source.set(retained, 0);
    retained = to < height ? source.slice((Math.max(first, to - radius) - first) * rowStride, (to - first) * rowStride) : undefined;
    const luma = new Float32Array(source.length / stride);
    for (let i = 0; i < luma.length; i++) {
      const j = i * stride;
      luma[i] = (0.2126 * source[j] + 0.7152 * source[j + 1] + 0.0722 * source[j + 2]) / max;
    }
    for (let y = from; y < to; y++) for (let x = 0; x < width; x++) {
      const p = (y - first) * width + x, i = p * stride;
      if (stride === 4 && source[i + 3] !== 255) continue;
      const center = luma[p];
      const r = source[i] / max - center, b = source[i + 2] / max - center;
      let sum = center, weights = 1;
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
        const q = p + dy * width + dx, j = q * stride;
        if (stride === 4 && source[j + 3] !== 255) continue;
        const adjacent = luma[q];
        const similarity = Math.max(0, 1 - Math.abs(adjacent - center) / 0.085);
        const chroma = Math.max(Math.abs(source[j] / max - adjacent - r), Math.abs(source[j + 2] / max - adjacent - b));
        const weight = similarity ** 2 * Math.max(0, 1 - chroma / 0.12) / (1 + dx * dx + dy * dy);
        sum += adjacent * weight;
        weights += weight;
      }
      const low = Math.min(source[i], source[i + 1], source[i + 2]);
      const high = Math.max(source[i], source[i + 1], source[i + 2]);
      const smoothed = sum / weights;
      const here = zoned ? strengthAt(strength * 2, zoneRaw, smoothed, scratch) / 2 : strength;
      const shift = Math.round(Math.max(-low, Math.min(max - high, (smoothed - center) * here * max)));
      const out = (y * width + x) * stride;
      for (let c = 0; c < 3; c++) pixels[out + c] = source[i + c] + shift;
    }
  }
}
