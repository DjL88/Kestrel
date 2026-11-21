/**
 * Layer 1 of Upscale: an ordinary, deterministic, high-quality resampler (Lanczos-3 with an optional mild sharpen).
 * It needs no model and works on every platform, so it is also the fallback whenever the optional learned enlarger
 * is unavailable or fails.
 *
 * It enlarges pixels. It cannot add detail the photo never recorded, and it makes no claim to match any other
 * editor. Works on 8-bit (Uint8ClampedArray) or 16-bit (Uint16Array) interleaved samples without ever narrowing a
 * 16-bit image to eight bits. The vertical pass runs in bands of output rows, so the scratch memory is bounded
 * whatever the picture size (only the result itself is whole).
 */

export type Samples = Uint8ClampedArray | Uint16Array;

export interface PixelBuffer<T extends Samples = Samples> {
  data: T;
  width: number;
  height: number;
  /** Interleaved samples per pixel: 1 (grey), 3 (RGB) or 4 (RGBA; alpha is resampled but never sharpened). */
  channels: 1 | 3 | 4;
}

export interface ResampleOptions {
  /** 0 (none) to 1. Default 0.2: just enough to undo the softness a resize adds. */
  sharpen?: number;
  /** Largest scratch buffer, in samples. Default about 8 million (32 MB). */
  scratchSamples?: number;
  signal?: AbortSignal;
  /** Called with a fraction between 0 and 1 after each band. */
  onProgress?: (fraction: number) => void;
}

export const MAX_OUTPUT_PIXELS = 200_000_000;
export const DEFAULT_SHARPEN = 0.2;
const DEFAULT_SCRATCH = 8_000_000;
const LOBES = 3;

const sinc = (x: number): number => {
  if (x === 0) return 1;
  const p = Math.PI * x;
  return Math.sin(p) / p;
};

export const lanczos3 = (x: number): number => {
  const a = Math.abs(x);
  return a >= LOBES ? 0 : sinc(a) * sinc(a / LOBES);
};

interface AxisWeights { start: Int32Array; count: Int32Array; weights: Float32Array; stride: number }

/** For each output position, which source samples contribute and by how much (normalised to sum to 1). */
export function axisWeights(srcSize: number, dstSize: number): AxisWeights {
  const ratio = srcSize / dstSize;
  const filterScale = Math.max(1, ratio); // Widen the kernel when shrinking so it still averages.
  const support = LOBES * filterScale;
  const stride = Math.ceil(support * 2) + 2;
  const start = new Int32Array(dstSize);
  const count = new Int32Array(dstSize);
  const weights = new Float32Array(dstSize * stride);
  for (let o = 0; o < dstSize; o++) {
    const centre = (o + 0.5) * ratio - 0.5;
    const first = Math.max(0, Math.ceil(centre - support));
    const last = Math.min(srcSize - 1, Math.floor(centre + support));
    let total = 0;
    const base = o * stride;
    for (let i = first; i <= last; i++) {
      const w = lanczos3((i - centre) / filterScale);
      weights[base + i - first] = w;
      total += w;
    }
    if (total === 0) { weights[base] = 1; total = 1; } // Cannot happen for sane sizes; keep the maths safe.
    for (let k = 0; k <= last - first; k++) weights[base + k] /= total;
    start[o] = first;
    count[o] = last - first + 1;
  }
  return { start, count, weights, stride };
}

function validate(src: PixelBuffer, dstWidth: number, dstHeight: number): void {
  const ok = (n: number) => Number.isSafeInteger(n) && n >= 1;
  if (!ok(src.width) || !ok(src.height) || !ok(dstWidth) || !ok(dstHeight)) throw new RangeError('Image sizes must be whole numbers of at least 1 pixel.');
  if (src.data.length !== src.width * src.height * src.channels) throw new RangeError('The pixel data does not match the image size.');
  if (dstWidth * dstHeight > MAX_OUTPUT_PIXELS) throw new RangeError('That output size is too large to make safely. Choose a smaller size.');
}

/** Resample to an exact output size. Returns a new buffer of the same sample type; the input is never changed. */
export function resampleLanczos3<T extends Samples>(src: PixelBuffer<T>, dstWidth: number, dstHeight: number, options: ResampleOptions = {}): PixelBuffer<T> {
  validate(src, dstWidth, dstHeight);
  const { channels, width: sw, height: sh } = src;
  const max = src.data instanceof Uint16Array ? 65535 : 255;
  const out = new (src.data.constructor as new (n: number) => T)(dstWidth * dstHeight * channels);
  const sharpen = Math.min(1, Math.max(0, options.sharpen ?? 0));
  const xw = axisWeights(sw, dstWidth);
  const yw = axisWeights(sh, dstHeight);
  const budget = Math.max(options.scratchSamples ?? DEFAULT_SCRATCH, (yw.stride + 1) * dstWidth * channels);
  const rowSamples = dstWidth * channels;
  const scratchRows = Math.floor(budget / rowSamples);
  const scratch = new Float32Array(scratchRows * rowSamples);

  let y = 0;
  while (y < dstHeight) {
    options.signal?.throwIfAborted();
    // Grow the band while the source rows it needs still fit in the scratch buffer.
    let end = y;
    let lo = yw.start[y];
    let hi = yw.start[y] + yw.count[y] - 1;
    while (end < dstHeight) {
      const l = Math.min(lo, yw.start[end]);
      const h = Math.max(hi, yw.start[end] + yw.count[end] - 1);
      if (h - l + 1 > scratchRows) break;
      lo = l; hi = h; end++;
    }
    if (end === y) throw new RangeError('The scratch budget is too small for this resize.');
    // Horizontal pass for the needed source rows.
    for (let r = lo; r <= hi; r++) {
      const srcBase = r * sw * channels;
      const dstBase = (r - lo) * rowSamples;
      for (let x = 0; x < dstWidth; x++) {
        const first = xw.start[x], n = xw.count[x], wBase = x * xw.stride;
        for (let c = 0; c < channels; c++) {
          let acc = 0;
          for (let k = 0; k < n; k++) acc += src.data[srcBase + (first + k) * channels + c] * xw.weights[wBase + k];
          scratch[dstBase + x * channels + c] = acc;
        }
      }
    }
    // Vertical pass for the band's output rows.
    for (let o = y; o < end; o++) {
      const first = yw.start[o], n = yw.count[o], wBase = o * yw.stride;
      const outBase = o * rowSamples;
      for (let s = 0; s < rowSamples; s++) {
        let acc = 0;
        for (let k = 0; k < n; k++) acc += scratch[(first + k - lo) * rowSamples + s] * yw.weights[wBase + k];
        out[outBase + s] = acc < 0 ? 0 : acc > max ? max : Math.round(acc);
      }
    }
    y = end;
    options.onProgress?.(sharpen > 0 ? (y / dstHeight) * 0.95 : y / dstHeight);
  }
  const result: PixelBuffer<T> = { data: out, width: dstWidth, height: dstHeight, channels };
  if (sharpen > 0) mildSharpen(result, sharpen, max);
  options.onProgress?.(1);
  return result;
}

/** Unsharp mask with a 3x3 blur, done in place with two rolling rows. Colour channels only; alpha is left alone. */
export function mildSharpen(image: PixelBuffer, amount: number, max = image.data instanceof Uint16Array ? 65535 : 255): void {
  const { width, height, channels, data } = image;
  const colour = channels === 4 ? 3 : channels;
  const row = width * channels;
  let prev = new Float32Array(row), cur = new Float32Array(row), next = new Float32Array(row);
  const load = (y: number, into: Float32Array) => { for (let i = 0; i < row; i++) into[i] = data[y * row + i]; };
  load(0, cur);
  prev.set(cur); // Edge rows reuse themselves.
  for (let y = 0; y < height; y++) {
    if (y + 1 < height) load(y + 1, next); else next.set(cur); // Rows below are still the originals.
    for (let x = 0; x < width; x++) {
      const xl = Math.max(0, x - 1) * channels, xr = Math.min(width - 1, x + 1) * channels, xc = x * channels;
      for (let c = 0; c < colour; c++) {
        const centre = cur[xc + c];
        const blur = (
          prev[xl + c] + 2 * prev[xc + c] + prev[xr + c] +
          2 * cur[xl + c] + 4 * centre + 2 * cur[xr + c] +
          next[xl + c] + 2 * next[xc + c] + next[xr + c]
        ) / 16;
        const v = centre + amount * (centre - blur);
        data[y * row + xc + c] = v < 0 ? 0 : v > max ? max : Math.round(v);
      }
    }
    const old = prev; prev = cur; cur = next; next = old;
  }
}

/** Largest whole factor (2 or 4) that does not overshoot the target, or 1 when the target is not larger. */
export function upscaleFactorFor(srcLongEdge: number, targetLongEdge: number): number {
  return targetLongEdge <= srcLongEdge ? 1 : targetLongEdge / srcLongEdge;
}
