/**
 * Capture sharpening and mild deblur (Gap G6, 25 Nov 2026).
 *
 * Both are the same conventional, non-generative operation: a few damped Richardson-Lucy deconvolution steps on the
 * picture's luminance with a small Gaussian point-spread function (PSF). Deconvolution only redistributes light that
 * is already in neighbouring pixels back towards where the lens and sensor spread it from. It never invents texture,
 * never runs a model, and every output pixel is bounded by its own 3 x 3 neighbourhood, so it cannot add halos or
 * detail that was not recorded.
 *
 * - Capture sharpening undoes the softness every sensor adds (pixel aperture, demosaicing and, where fitted, the
 *   anti-aliasing filter). The PSF comes from a per-camera profile. The Nikon Z8 and Z5II profiles are starting values
 *   from the sensors' published geometry; they still need the owner's blind test frames to confirm them.
 * - Mild deblur widens the PSF for slight focus or camera-shake softness, up to about 1.4 sensor pixels. It is not a
 *   motion-blur or missed-focus rescue and makes no claim to be one.
 *
 * Preview and export agree: the PSF is defined in the camera's sensor pixels and scaled to the picture being rendered
 * (`imageEdge`), and the 8-bit screen path and the 16-bit export run the same function. At fit-to-screen sizes the
 * scaled PSF is far below a pixel, so nothing is applied: the effect is only visible, and only real, near 100% zoom.
 */

export type CaptureProfileId = 'nikon-z8' | 'nikon-z5ii' | 'generic';

export interface CaptureProfile {
  /** PSF standard deviation in sensor pixels. */
  sigma: number;
  /** Long edge of the sensor's full-size picture, used to scale the PSF to smaller renders. */
  sensorEdge: number;
}

export const CAPTURE_PROFILES: Readonly<Record<CaptureProfileId, CaptureProfile>> = {
  // 45.7 MP stacked BSI, 4.35 µm pixels, no optical low-pass filter: only pixel aperture and demosaic softness.
  'nikon-z8': { sigma: 0.55, sensorEdge: 8256 },
  // 24.5 MP BSI, about 5.9 µm pixels. Assumes an anti-aliasing filter, as on the Z5, so a slightly wider PSF.
  'nikon-z5ii': { sigma: 0.75, sensorEdge: 6048 },
  // Any other camera: a cautious middle value on a typical 24 MP long edge.
  generic: { sigma: 0.6, sensorEdge: 6000 },
};

export interface CaptureSharpen {
  /** 0 (off) to 1. */
  amount: number;
  profile: CaptureProfileId;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function validCaptureSharpen(value: unknown): value is CaptureSharpen {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<CaptureSharpen>;
  return finite(v.amount) && v.amount >= 0 && v.amount <= 1 && typeof v.profile === 'string' && Object.hasOwn(CAPTURE_PROFILES, v.profile);
}

export const validDeblur = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;

/** The profile for a camera's EXIF model ("NIKON Z 8", "NIKON Z5_2", "Nikon Z5II"), or generic. */
export function captureProfileFor(camera: string | undefined): CaptureProfileId {
  const model = (camera ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/z8$/.test(model)) return 'nikon-z8';
  if (/z5(2|ii)$/.test(model)) return 'nikon-z5ii';
  return 'generic';
}

interface CaptureEdit { captureSharpen?: CaptureSharpen; deblur?: number }

export function hasCaptureDetail(edit: CaptureEdit): boolean {
  return (validCaptureSharpen(edit.captureSharpen) && edit.captureSharpen.amount > 0) || (validDeblur(edit.deblur) && edit.deblur > 0);
}

/** Below this PSF width (in rendered pixels) deconvolution changes nothing visible, so it is skipped. */
export const MIN_SIGMA = 0.3;
/** Detail steps smaller than this (0..1 luma) fade out, so sensor noise is not sharpened. */
export const DECONV_CORE = 0.004;
/** How far past its neighbours' range a pixel may go, as a share of that range. Keeps edges free of halos. */
export const OVERSHOOT = 0.1;

export interface DeconvolutionParams { sigma: number; iterations: number; strength: number; radius: number }

/** The deconvolution to run on a picture whose long edge is `imageEdge` pixels, or null when it would do nothing. */
export function deconvolutionParams(edit: CaptureEdit, imageEdge: number): DeconvolutionParams | null {
  if (!hasCaptureDetail(edit)) return null;
  const capture = validCaptureSharpen(edit.captureSharpen) && edit.captureSharpen.amount > 0 ? edit.captureSharpen : null;
  const deblur = validDeblur(edit.deblur) ? edit.deblur : 0;
  const profile = CAPTURE_PROFILES[validCaptureSharpen(edit.captureSharpen) ? edit.captureSharpen.profile : 'generic'];
  const deblurSigma = deblur > 0 ? 0.4 + deblur : 0;
  const sensorSigma = Math.sqrt((capture ? profile.sigma ** 2 : 0) + deblurSigma ** 2);
  const sigma = sensorSigma * Math.min(1, imageEdge / profile.sensorEdge);
  if (!(sigma >= MIN_SIGMA)) return null;
  const strength = deblur > 0 ? Math.max(capture?.amount ?? 0, 0.6 + 0.4 * deblur) : capture!.amount;
  return { sigma, iterations: 3 + Math.round(5 * deblur), strength, radius: Math.ceil(3 * sigma) };
}

/** Rows of neighbourhood each output row depends on: two blurs per iteration plus the 3 x 3 halo limit. */
export const deconvolutionReach = (p: DeconvolutionParams) => 2 * p.iterations * p.radius + 1;

function gaussianKernel(sigma: number, radius: number): Float32Array {
  const k = Float32Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  const sum = k.reduce((a, b) => a + b, 0);
  return k.map((v) => v / sum);
}

/** Separable Gaussian blur with clamped edges, into `out` (`temp` is scratch). */
function blur(source: Float32Array, width: number, height: number, kernel: Float32Array, temp: Float32Array, out: Float32Array): void {
  const r = (kernel.length - 1) / 2;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let s = 0;
      for (let k = -r; k <= r; k += 1) s += kernel[k + r] * source[row + Math.min(width - 1, Math.max(0, x + k))];
      temp[row + x] = s;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let s = 0;
      for (let k = -r; k <= r; k += 1) s += kernel[k + r] * temp[Math.min(height - 1, Math.max(0, y + k)) * width + x];
      out[y * width + x] = s;
    }
  }
}

const EPS = 1e-3;

/** Damped Richardson-Lucy: the luminance the PSF would blur into `luma`, bounded per step so it cannot ring. */
export function richardsonLucy(luma: Float32Array, width: number, height: number, p: DeconvolutionParams): Float32Array {
  const kernel = gaussianKernel(p.sigma, p.radius);
  const observed = luma.map((v) => v + EPS);
  const u = observed.slice();
  const temp = new Float32Array(luma.length), est = new Float32Array(luma.length), ratio = new Float32Array(luma.length);
  for (let it = 0; it < p.iterations; it += 1) {
    blur(u, width, height, kernel, temp, est);
    for (let i = 0; i < u.length; i += 1) ratio[i] = Math.min(2, Math.max(0.5, observed[i] / est[i]));
    blur(ratio, width, height, kernel, temp, est);
    for (let i = 0; i < u.length; i += 1) u[i] *= est[i];
  }
  for (let i = 0; i < u.length; i += 1) u[i] -= EPS;
  return u;
}

const core = (d: number) => d * d * d / (d * d + DECONV_CORE * DECONV_CORE);

function lumaOf(pixels: Uint8ClampedArray | Uint16Array, stride: number, max: number, width: number, from: number, to: number): Float32Array {
  const luma = new Float32Array(width * (to - from));
  for (let i = 0; i < luma.length; i += 1) {
    const j = (from * width + i) * stride;
    luma[i] = (0.2126 * pixels[j] + 0.7152 * pixels[j + 1] + 0.0722 * pixels[j + 2]) / max;
  }
  return luma;
}

/**
 * Write rows `from`..`to` of `pixels`, measured on `luma` (rows `lumaFrom` onwards, `lumaRows` of them, untouched).
 * Each pixel moves towards the deconvolved luminance, kept within its 3 x 3 neighbours' range plus a small overshoot,
 * with noise-sized steps faded out. The same change is added to red, green and blue, so colour is not shifted.
 */
function deconvolveRows(
  pixels: Uint8ClampedArray | Uint16Array, stride: number, max: number, width: number,
  luma: Float32Array, lumaFrom: number, lumaRows: number, from: number, to: number, p: DeconvolutionParams,
): void {
  const sharp = richardsonLucy(luma, width, lumaRows, p);
  for (let row = from; row < to; row += 1) {
    const r = row - lumaFrom;
    for (let x = 0; x < width; x += 1) {
      const i = r * width + x;
      let lo = Infinity, hi = -Infinity;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = Math.min(lumaRows - 1, Math.max(0, r + dy)) * width;
        for (let dx = -1; dx <= 1; dx += 1) {
          const v = luma[yy + Math.min(width - 1, Math.max(0, x + dx))];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      const o = OVERSHOOT * (hi - lo);
      const target = Math.min(hi + o, Math.max(lo - o, sharp[i]));
      const add = p.strength * core(target - luma[i]);
      if (add === 0) continue;
      const j = (row * width + x) * stride;
      for (let c = 0; c < 3; c += 1) pixels[j + c] = Math.round(Math.min(1, Math.max(0, pixels[j + c] / max + add)) * max);
    }
  }
}

/** Capture sharpening and deblur on 8-bit RGBA (the screen and canvas export). `imageEdge` as for detailParams. */
export function applyCaptureDetail(pixels: Uint8ClampedArray, width: number, height: number, edit: CaptureEdit, imageEdge: number): void {
  const p = deconvolutionParams(edit, imageEdge);
  if (!p || width < 3 || height < 3) return;
  deconvolveRows(pixels, 4, 255, width, lumaOf(pixels, 4, 255, width, 0, height), 0, height, 0, height, p);
}

/**
 * The same on 16-bit RGB, in bands so a 45-megapixel export never holds whole-picture float buffers. Each band reads
 * an untouched margin as wide as the deconvolution's reach, so the bands join exactly.
 */
export function applyCaptureDetailRgb16(pixels: Uint16Array, width: number, height: number, edit: CaptureEdit, imageEdge: number, bandRows?: number): void {
  const p = deconvolutionParams(edit, imageEdge);
  if (!p || width < 3 || height < 3) return;
  const margin = deconvolutionReach(p);
  const band = Math.max(2 * margin, bandRows ?? Math.max(64, Math.floor(2_000_000 / width)));
  let kept: Uint16Array | null = null;
  for (let from = 0; from < height; from += band) {
    const to = Math.min(height, from + band);
    const lumaFrom = Math.max(0, from - margin);
    const lumaTo = Math.min(height, to + margin);
    const luma = lumaOf(pixels, 3, 65535, width, lumaFrom, lumaTo);
    if (kept && from > lumaFrom) luma.set(lumaOf(kept, 3, 65535, width, 0, from - lumaFrom), 0);
    kept = to < height ? pixels.slice(Math.max(0, to - margin) * width * 3, to * width * 3) : null;
    deconvolveRows(pixels, 3, 65535, width, luma, lumaFrom, lumaTo - lumaFrom, from, to, p);
  }
}
