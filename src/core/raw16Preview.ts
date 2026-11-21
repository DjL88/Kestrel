import { parseRgb16, type Rgb16Image } from './master16';

/** A display-only 8-bit proof derived from the 16-bit working image.
 * Never feed these pixels back into the edit master or archival export.
 * The decoder currently supplies display-encoded sRGB16, NOT scene-linear CFA.
 */
export interface Raw16Proof { width: number; height: number; rgba: Uint8ClampedArray; source: 'rgb16-display-preview' }
export function raw16Proof(image: Rgb16Image, maxEdge = 1600): Raw16Proof {
  const { width, height, data } = image;
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || width <= 0 || height <= 0 ||
      pixels > 80_000_000 || data.length !== pixels * 3) throw new Error('Invalid high-precision image.');
  if (!Number.isSafeInteger(maxEdge) || maxEdge < 1 || maxEdge > 4096) throw new Error('Invalid proof size.');
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const rgba = new Uint8ClampedArray(w * h * 4);
  const linear = (v: number) => { const s = v / 65535; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const encoded = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  // Area-average in linear light: no JPEG generation, no 8-bit intermediate,
  // and no colour-darkening from averaging gamma-encoded samples.
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * height / h), y1 = Math.max(y0 + 1, Math.ceil((y + 1) * height / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * width / w), x1 = Math.max(x0 + 1, Math.ceil((x + 1) * width / w));
      const sums = [0, 0, 0];
      let count = 0;
      for (let sy = y0; sy < Math.min(height, y1); sy++) for (let sx = x0; sx < Math.min(width, x1); sx++) {
        const at = (sy * width + sx) * 3;
        for (let c = 0; c < 3; c++) sums[c] += linear(data[at + c]);
        count++;
      }
      const out = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) rgba[out + c] = encoded(sums[c] / count);
      rgba[out + 3] = 255;
    }
  }
  return { width: w, height: h, rgba, source: 'rgb16-display-preview' };
}

/** The full RGB16 remains separate and authoritative. No preview is promoted. */
export function proofFromDecoderBuffer(buffer: ArrayBuffer, maxEdge?: number): Raw16Proof {
  return raw16Proof(parseRgb16(buffer), maxEdge);
}
