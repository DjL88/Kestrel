import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { lightness } from '../../src/core/enhanceObserve';
import { toOklab } from '../../src/core/colourCheck';

export interface Img { rgba: Uint8ClampedArray; width: number; height: number }

export function loadJpeg(path: string): Img {
  const d = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
  return { rgba: new Uint8ClampedArray(d.data.buffer, d.data.byteOffset, d.data.byteLength), width: d.width, height: d.height };
}

/** Area-average downscale so the long edge is at most `edge`. Never upscales. */
export function downscale(img: Img, edge: number): Img {
  const scale = Math.min(1, edge / Math.max(img.width, img.height));
  if (scale === 1) return img;
  const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.floor((y * img.height) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.floor((x * img.width) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
      let r = 0, g = 0, b = 0, c = 0;
      for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) {
        const i = (yy * img.width + xx) * 4; r += img.rgba[i]; g += img.rgba[i + 1]; b += img.rgba[i + 2]; c += 1;
      }
      const o = (y * w + x) * 4;
      out[o] = r / c; out[o + 1] = g / c; out[o + 2] = b / c; out[o + 3] = 255;
    }
  }
  return { rgba: out, width: w, height: h };
}

export function jpegBase64(img: Img, quality = 70): string {
  const enc = jpeg.encode({ data: Buffer.from(img.rgba.buffer, img.rgba.byteOffset, img.rgba.byteLength), width: img.width, height: img.height }, quality);
  return Buffer.from(enc.data).toString('base64');
}

/** Mean absolute difference in perceptual lightness (0 to 1) between two same-size pictures. */
export function meanAbsLightnessDiff(a: Img, b: Img): number {
  const n = a.width * a.height;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    sum += Math.abs(lightness(a.rgba[i * 4], a.rgba[i * 4 + 1], a.rgba[i * 4 + 2]) - lightness(b.rgba[i * 4], b.rgba[i * 4 + 1], b.rgba[i * 4 + 2]));
  }
  return sum / n;
}

/** Mean Oklab (a, b) over the whole picture (sampled). Used to compare colour balance between two versions of one photo. */
export function meanAB(img: Img): { a: number; b: number } {
  const n = img.width * img.height, stride = Math.max(1, Math.floor(n / 60000));
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < n; i += stride) { const o = toOklab(img.rgba[i * 4], img.rgba[i * 4 + 1], img.rgba[i * 4 + 2]); a += o[1]; b += o[2]; c += 1; }
  return { a: a / c, b: b / c };
}

/** Distance between two pictures' overall colour balance (Oklab a/b means). */
export function castDistance(x: Img, y: Img): number {
  const p = meanAB(x), q = meanAB(y);
  return Math.hypot(p.a - q.a, p.b - q.b);
}
