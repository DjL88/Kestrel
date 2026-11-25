import type { Rgb16Image } from './master16';

/**
 * The last steps of the high-precision pipeline. The working picture stays RGB16 through every edit; these make it
 * output-sized and, only for an 8-bit destination (the screen, a JPEG), round it once, with dither so a smooth
 * gradient stays smooth. Both are deterministic: the same picture always gives the same bytes.
 */

/** Area-average resize of an RGB16 picture, never enlarging. Works on the display-encoded values, as the screen does. */
export function downscaleRgb16(image: Rgb16Image, width: number, height: number): Rgb16Image {
  const { width: sw, height: sh, data } = image;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > sw || height > sh)
    throw new Error('Invalid 16-bit resize.');
  if (data.length !== sw * sh * 3) throw new Error('Invalid high-precision image.');
  if (width === sw && height === sh) return { width, height, data: data.slice() };
  const out = new Uint16Array(width * height * 3);
  // Fractional box filter: each output pixel averages the exact source area it covers, weighting partly covered pixels.
  const xs = spans(sw, width);
  const ys = spans(sh, height);
  const row = new Float64Array(width * 3);
  for (let y = 0; y < height; y += 1) {
    row.fill(0);
    const [y0, y1, yWeights] = ys[y];
    for (let sy = y0; sy < y1; sy += 1) {
      const wy = yWeights[sy - y0];
      const base = sy * sw * 3;
      for (let x = 0; x < width; x += 1) {
        const [x0, x1, xWeights] = xs[x];
        let r = 0, g = 0, b = 0;
        for (let sx = x0; sx < x1; sx += 1) {
          const w = xWeights[sx - x0];
          const at = base + sx * 3;
          r += data[at] * w; g += data[at + 1] * w; b += data[at + 2] * w;
        }
        row[x * 3] += r * wy; row[x * 3 + 1] += g * wy; row[x * 3 + 2] += b * wy;
      }
    }
    const area = (sw / width) * (sh / height);
    for (let i = 0; i < width * 3; i += 1) out[y * width * 3 + i] = Math.min(65535, Math.round(row[i] / area));
  }
  return { width, height, data: out };
}

function spans(source: number, target: number): Array<[number, number, Float64Array]> {
  const ratio = source / target;
  return Array.from({ length: target }, (_, i) => {
    const start = i * ratio, end = (i + 1) * ratio;
    const first = Math.floor(start), last = Math.min(source, Math.ceil(end));
    const weights = new Float64Array(last - first);
    for (let s = first; s < last; s += 1) weights[s - first] = Math.min(end, s + 1) - Math.max(start, s);
    return [first, last, weights];
  });
}

/**
 * RGB16 to 8-bit RGBA, rounded once. Triangular dither of ±1 level, from a hash of the pixel's position and channel
 * (no randomness), hides the 8-bit steps of a gradient: the local average stays at the true 16-bit value.
 * `originX`/`originY` place a tile in a larger picture, so tiles join exactly.
 */
export function ditherRgb16ToRgba8(image: Rgb16Image, originX = 0, originY = 0): Uint8ClampedArray {
  const { width, height, data } = image;
  if (data.length !== width * height * 3) throw new Error('Invalid high-precision image.');
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 3;
      const to = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const level = data[from + c] / 257;
        out[to + c] = Math.round(level + triangular(originX + x, originY + y, c));
      }
      out[to + 3] = 255;
    }
  }
  return out;
}

/** A value in (-1, 1) with a triangular distribution, fixed for each position and channel. */
function triangular(x: number, y: number, c: number): number {
  const a = hash(x, y, c * 2 + 1), b = hash(x, y, c * 2 + 2);
  return (a + b) / 4294967296 - 1;
}

function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
