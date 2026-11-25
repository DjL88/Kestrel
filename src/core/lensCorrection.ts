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
 * - a lens profile (lensfun, see lensProfiles.ts) brings its own measured distortion and vignetting, in the units it was
 *   measured in; `scale` converts this photo's normalised radius to them. The profile runs first and the sliders on top.
 * After a distortion correction the picture is enlarged just enough that no empty edge shows.
 */
import type { MaskContext } from './masks';

export interface LensCorrection {
  /** Manual distortion, -1..1: positive fixes barrel (lines bowing out), negative fixes pincushion. */
  distortion?: number;
  /** Manual lens vignetting correction, 0..1: brightens the corners the lens darkened. */
  vignetting?: number;
  /** A measured profile for the lens that took the photo, resolved once for its focal length and aperture and stored here,
   * so preview, exports and reopening never need the lens database again. */
  profile?: LensProfile;
}

/** Why part of a profile is not applied, said in words to the person. */
export type LensProfileNote = 'no-vignetting' | 'no-aperture' | 'no-distortion' | 'assumed-sensor';

export interface LensProfile {
  /** The lens's name as the database gives it. */
  name: string;
  /** lensfun distortion. ptlens: k = [a, b, c]; poly3: k = [k1]; poly5: k = [k1, k2]. r_d = r_u g(r_u) in the profile's units. */
  distortion?: { model: 'ptlens' | 'poly3' | 'poly5'; k: number[]; scale: number };
  /** lensfun "pa" vignetting: the lens dims light by 1 + k1 r^2 + k2 r^4 + k3 r^6 in the profile's units. */
  vignetting?: { k: [number, number, number]; scale: number };
  notes?: LensProfileNote[];
}

/** k at slider 1: about the barrel of a wide zoom at its widest. */
export const MAX_DISTORTION_K = 0.12;
/** Corner light at slider 1 is assumed to be 40% of the centre's: about 1.3 stops, a fast wide lens wide open. */
export const MAX_VIGNETTE_K = -0.6;
const MAX_GAIN = 4;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const terms = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every((t) => finite(t) && Math.abs(t) < 5);
const scaleOk = (v: unknown) => finite(v) && v > 0.05 && v < 20;
const TERM_COUNT = { ptlens: 3, poly3: 1, poly5: 2 } as const;
const NOTES: readonly string[] = ['no-vignetting', 'no-aperture', 'no-distortion', 'assumed-sensor'];

export function validLensProfile(value: unknown): value is LensProfile {
  if (!record(value) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200) return false;
  const d = value.distortion, v = value.vignetting;
  if (d !== undefined && !(record(d) && (d.model === 'ptlens' || d.model === 'poly3' || d.model === 'poly5') && terms(d.k, TERM_COUNT[d.model]) && scaleOk(d.scale))) return false;
  if (v !== undefined && !(record(v) && terms(v.k, 3) && scaleOk(v.scale))) return false;
  if (value.notes !== undefined && !(Array.isArray(value.notes) && value.notes.every((n) => NOTES.includes(n as string)))) return false;
  return d !== undefined || v !== undefined;
}

export function validLens(value: unknown): value is LensCorrection {
  if (!record(value)) return false;
  const v = value;
  return (v.distortion === undefined || (finite(v.distortion) && v.distortion >= -1 && v.distortion <= 1))
    && (v.vignetting === undefined || (finite(v.vignetting) && v.vignetting >= 0 && v.vignetting <= 1))
    && (v.profile === undefined || validLensProfile(v.profile));
}
export const hasLensCorrection = (lens: LensCorrection | undefined) => !!lens && (!!lens.distortion || !!lens.vignetting || !!lens.profile);

/** Where the picture is read for an output point at normalised radius rho: rho times this factor. */
type RadialFactor = (rho: number) => number;

/** The profile's own source factor in normalised radius, keeping the centre's scale at 1 (fillScale does the enlarging). */
function profileFactor(d: NonNullable<LensProfile['distortion']>): RadialFactor {
  const s = d.scale;
  if (d.model === 'ptlens') {
    const [a, b, c] = d.k;
    const centre = 1 - a - b - c;
    return (rho) => { const r = rho * s; return (a * r * r * r + b * r * r + c * r + centre) / centre; };
  }
  if (d.model === 'poly3') {
    const [k1] = d.k;
    return (rho) => { const r = rho * s; return (1 - k1 + k1 * r * r) / (1 - k1); };
  }
  const [k1, k2] = d.k;
  return (rho) => { const r2 = rho * s * rho * s; return 1 + k1 * r2 + k2 * r2 * r2; };
}

/** The profile first, then the slider: the slider corrects what is left after the profile. */
function distortionFactor(k: number, profile: LensProfile['distortion']): RadialFactor | null {
  const manual: RadialFactor | null = k ? (rho) => 1 + k * rho * rho : null;
  const lens = profile ? profileFactor(profile) : null;
  if (manual && lens) return (rho) => { const m = manual(rho); return m * lens(rho * m); };
  return manual ?? lens;
}

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

function applyVignetting(pixels: Uint8ClampedArray | Uint16Array, width: number, height: number, stride: 3 | 4, k: number, profile: LensProfile['vignetting'], cx: number, cy: number, radius: number): void {
  const max = pixels instanceof Uint16Array ? 65535 : 255;
  // 8-bit: a table from code value to linear light; 16-bit: computed directly.
  const lut = max === 255 ? Float32Array.from({ length: 256 }, (_, i) => toLinear(i / 255)) : null;
  for (let y = 0; y < height; y += 1) {
    const dy = (y + 0.5 - cy) / radius;
    for (let x = 0; x < width; x += 1) {
      const dx = (x + 0.5 - cx) / radius;
      const r2 = dx * dx + dy * dy;
      let fall = 1 + k * r2;
      if (profile) {
        const p2 = r2 * profile.scale * profile.scale;
        fall *= 1 + profile.k[0] * p2 + profile.k[1] * p2 * p2 + profile.k[2] * p2 * p2 * p2;
      }
      const gain = Math.min(MAX_GAIN, 1 / Math.max(1e-3, fall));
      if (gain === 1) continue;
      const i = (y * width + x) * stride;
      for (let c = 0; c < 3; c += 1) {
        const linear = lut ? lut[pixels[i + c]] : toLinear(pixels[i + c] / max);
        pixels[i + c] = Math.round(Math.min(1, toDisplay(Math.min(1, linear * gain))) * max);
      }
    }
  }
}

/** Enlargement that keeps every sample inside the picture after a manual distortion correction with this k. */
export function fillScale(width: number, height: number, k: number, cx: number, cy: number, radius: number): number {
  return k === 0 ? 1 : fillScaleFor(width, height, (rho) => 1 + k * rho * rho, cx, cy, radius);
}

function fillScaleFor(width: number, height: number, factor: RadialFactor, cx: number, cy: number, radius: number): number {
  const edge: Array<[number, number]> = [];
  for (let t = 0; t <= 16; t += 1) {
    const u = (t / 16) * width, v = (t / 16) * height;
    edge.push([u, 0], [u, height], [0, v], [width, v]);
  }
  const fits = (z: number) => edge.every(([x, y]) => {
    const dx = (x - cx) / z, dy = (y - cy) / z;
    const f = factor(Math.hypot(dx, dy) / radius);
    const sx = cx + dx * f, sy = cy + dy * f;
    return sx >= -0.5 && sx <= width + 0.5 && sy >= -0.5 && sy <= height + 0.5;
  });
  if (fits(1)) return 1;
  let low = 1, high = 2;
  while (!fits(high) && high < 8) high *= 2;
  for (let n = 0; n < 30; n += 1) { const mid = (low + high) / 2; if (fits(mid)) high = mid; else low = mid; }
  return high;
}

function applyDistortion(pixels: Uint8ClampedArray | Uint16Array, width: number, height: number, stride: 3 | 4, factor: RadialFactor, cx: number, cy: number, radius: number): void {
  const source = pixels.slice();
  const max = pixels instanceof Uint16Array ? 65535 : 255;
  const z = fillScaleFor(width, height, factor, cx, cy, radius);
  const inv = 1 / radius;
  for (let y = 0; y < height; y += 1) {
    const dy = (y + 0.5 - cy) / z;
    for (let x = 0; x < width; x += 1) {
      const dx = (x + 0.5 - cx) / z;
      const f = factor(Math.sqrt(dx * dx + dy * dy) * inv);
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
  const vignette = lens.profile?.vignetting;
  if (lens.vignetting || vignette) applyVignetting(pixels, width, height, stride, (lens.vignetting ?? 0) * MAX_VIGNETTE_K, vignette, cx, cy, radius);
  const factor = distortionFactor(-(lens.distortion ?? 0) * MAX_DISTORTION_K, lens.profile?.distortion);
  if (factor) applyDistortion(pixels, width, height, stride, factor, cx, cy, radius);
}
