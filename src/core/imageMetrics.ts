/** Plain image-quality numbers used to measure upscalers against a known original. Same-size, same-channel buffers only. */
import type { PixelBuffer } from './upscaleResample';

function check(a: PixelBuffer, b: PixelBuffer): void {
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) throw new RangeError('Images must be the same size to compare.');
}

const peak = (a: PixelBuffer) => (a.data instanceof Uint16Array ? 65535 : 255);

/** Peak signal-to-noise ratio in dB. Higher is closer; identical images give Infinity. */
export function psnr(a: PixelBuffer, b: PixelBuffer): number {
  check(a, b);
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) { const d = a.data[i] - b.data[i]; sum += d * d; }
  const mse = sum / a.data.length;
  return mse === 0 ? Infinity : 10 * Math.log10((peak(a) * peak(a)) / mse);
}

/** Mean structural similarity (8x8 non-overlapping windows on luma; 1 is identical). A simple, documented variant, not a reference implementation. */
export function ssim(a: PixelBuffer, b: PixelBuffer, window = 8): number {
  check(a, b);
  const lumaOf = (p: PixelBuffer, i: number) => p.channels === 1 ? p.data[i] : 0.2126 * p.data[i * p.channels] + 0.7152 * p.data[i * p.channels + 1] + 0.0722 * p.data[i * p.channels + 2];
  const L = peak(a), c1 = (0.01 * L) ** 2, c2 = (0.03 * L) ** 2;
  let total = 0, windows = 0;
  for (let y0 = 0; y0 + window <= a.height; y0 += window) {
    for (let x0 = 0; x0 + window <= a.width; x0 += window) {
      let ma = 0, mb = 0;
      const n = window * window;
      for (let y = 0; y < window; y++) for (let x = 0; x < window; x++) { const i = (y0 + y) * a.width + x0 + x; ma += lumaOf(a, i); mb += lumaOf(b, i); }
      ma /= n; mb /= n;
      let va = 0, vb = 0, cov = 0;
      for (let y = 0; y < window; y++) for (let x = 0; x < window; x++) {
        const i = (y0 + y) * a.width + x0 + x;
        const da = lumaOf(a, i) - ma, db = lumaOf(b, i) - mb;
        va += da * da; vb += db * db; cov += da * db;
      }
      va /= n - 1; vb /= n - 1; cov /= n - 1;
      total += ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
      windows++;
    }
  }
  return windows === 0 ? 1 : total / windows;
}
