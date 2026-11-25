/**
 * Lens corrections (25 Nov 2026): geometric distortion (barrel or pincushion) and the lens's own corner darkening.
 * Both are centred on the original photo's centre and measured against its half-diagonal, wherever the crop sits, so
 * the same numbers fit the preview, every export and the 16-bit TIFF. Pure; any size.
 *
 * Models (radius r normalised to the half-diagonal, r = 1 in the original's corners):
 * - distortion, 3rd order: a point the lens drew at r_d came from r_u, with r_d = r_u (1 + k r_u^2). The output at r_u
 *   reads the picture at r_d, so k < 0 undoes barrel (edges pulled in) and k > 0 undoes pincushion.
 * - vignetting: the lens dims light by v(r) = 1 + k1 r^2 + k2 r^4 + k3 r^6 (k < 0 darkens); correction divides by it,
 *   on linear light.
 * After a distortion correction the picture is enlarged just enough that no empty edge shows.
 */
import type { MaskContext } from './masks';

export interface LensCorrection {
  /** Manual distortion, -1..1: positive fixes barrel (lines bowing out), negative fixes pincushion. */
  distortion?: number;
  /** Manual lens vignetting correction, 0..1: brightens the corners the lens darkened. */
  vignetting?: number;
}

/** k at slider 1: about the barrel of a wide zoom at its widest. */
export const MAX_DISTORTION_K = 0.12;
/** Corner light at slider 1 is assumed to be 40% of the centre's: about 1.3 stops, a fast wide lens wide open. */
export const MAX_VIGNETTE_K = -0.6;
const MAX_GAIN = 4;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function validLens(value: unknown): value is LensCorrection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (v.distortion === undefined || (finite(v.distortion) && v.distortion >= -1 && v.distortion <= 1))
    && (v.vignetting === undefined || (finite(v.vignetting) && v.vignetting >= 0 && v.vignetting <= 1));
}
export const hasLensCorrection = (lens: LensCorrection | undefined) => !!lens && (!!lens.distortion || !!lens.vignetting);

/** Lens centre and half-diagonal in a canvas's pixels. */
export function canvasLens(width: number, height: number, context?: MaskContext): { cx: number; cy: number; radius: number } {
  const view = context?.view ?? { x: 0, y: 0, w: 1, h: 1 };
  const lens = context?.lensCentre ?? { x: 0.5, y: 0.5 };
  const frameWidth = width / view.w;
  const radius = (lens.r ?? Math.hypot(1, context?.aspect ?? height / width) / 2) * frameWidth;
  return { cx: ((lens.x - view.x) / view.w) * width, cy: ((lens.y - view.y) / view.h) * height, radius };
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toDisplay = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

function applyVignetting(pixels: Uint8ClampedArray | Uint16Array, width: number, height: number, stride: 3 | 4, k: number, cx: number, cy: number, radius: number): void {
  const max = pixels instanceof Uint16Array ? 65535 : 255;
  // 8-bit: a table from code value to linear light; 16-bit: computed directly.
  const lut = max === 255 ? Float32Array.from({ length: 256 }, (_, i) => toLinear(i / 255)) : null;
  for (let y = 0; y < height; y += 1) {
    const dy = (y + 0.5 - cy) / radius;
    for (let x = 0; x < width; x += 1) {
      const dx = (x + 0.5 - cx) / radius;
      const r2 = dx * dx + dy * dy;
      const gain = Math.min(MAX_GAIN, 1 / Math.max(1e-3, 1 + k * r2));
      if (gain === 1) continue;
      const i = (y * width + x) * stride;
      for (let c = 0; c < 3; c += 1) {
        const linear = lut ? lut[pixels[i + c]] : toLinear(pixels[i + c] / max);
        pixels[i + c] = Math.round(Math.min(1, toDisplay(Math.min(1, linear * gain))) * max);
      }
    }
  }
}

/** Enlargement that keeps every sample inside the picture after a distortion correction with this k. */
export function fillScale(width: number, height: number, k: number, cx: number, cy: number, radius: number): number {
  if (k === 0) return 1;
  const edge: Array<[number, number]> = [];
  for (let t = 0; t <= 16; t += 1) {
    const u = (t / 16) * width, v = (t / 16) * height;
    edge.push([u, 0], [u, height], [0, v], [width, v]);
  }
  const fits = (z: number) => edge.every(([x, y]) => {
    const dx = (x - cx) / z, dy = (y - cy) / z;
    const r2 = (dx * dx + dy * dy) / (radius * radius);
    const f = 1 + k * r2;
    const sx = cx + dx * f, sy = cy + dy * f;
    return sx >= -0.5 && sx <= width + 0.5 && sy >= -0.5 && sy <= height + 0.5;
  });
  if (fits(1)) return 1;
  let low = 1, high = 2;
  while (!fits(high) && high < 8) high *= 2;
  for (let n = 0; n < 30; n += 1) { const mid = (low + high) / 2; if (fits(mid)) high = mid; else low = mid; }
  return high;
}

function applyDistortion(pixels: Uint8ClampedArray | Uint16Array, width: number, height: number, stride: 3 | 4, k: number, cx: number, cy: number, radius: number): void {
  const source = pixels.slice();
  const max = pixels instanceof Uint16Array ? 65535 : 255;
  const z = fillScale(width, height, k, cx, cy, radius);
  const inv = 1 / (radius * radius);
  for (let y = 0; y < height; y += 1) {
    const dy = (y + 0.5 - cy) / z;
    for (let x = 0; x < width; x += 1) {
      const dx = (x + 0.5 - cx) / z;
      const f = 1 + k * (dx * dx + dy * dy) * inv;
      const fx = Math.min(width - 1, Math.max(0, cx + dx * f - 0.5));
      const fy = Math.min(height - 1, Math.max(0, cy + dy * f - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const a = (y0 * width + x0) * stride, b = (y0 * width + x1) * stride, c = (y1 * width + x0) * stride, d = (y1 * width + x1) * stride;
      const o = (y * width + x) * stride;
      for (let ch = 0; ch < (stride === 4 ? 4 : 3); ch += 1) {
        const top = source[a + ch] + (source[b + ch] - source[a + ch]) * tx;
        const bottom = source[c + ch] + (source[d + ch] - source[c + ch]) * tx;
        pixels[o + ch] = Math.round(Math.min(max, Math.max(0, top + (bottom - top) * ty)));
      }
    }
  }
}

/** Vignetting first (light falls off before the image is bent), then distortion. In place. */
export function applyLensCorrection(pixels: Uint8ClampedArray | Uint16Array, width: number, height: number, stride: 3 | 4, lens: LensCorrection | undefined, context?: MaskContext): void {
  if (!lens || !validLens(lens) || !hasLensCorrection(lens) || !width || !height) return;
  const { cx, cy, radius } = canvasLens(width, height, context);
  if (lens.vignetting) applyVignetting(pixels, width, height, stride, lens.vignetting * MAX_VIGNETTE_K, cx, cy, radius);
  if (lens.distortion) applyDistortion(pixels, width, height, stride, -lens.distortion * MAX_DISTORTION_K, cx, cy, radius);
}
