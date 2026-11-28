/** Numerical fit of the app's own global tone recipe to a target picture. Pure; no file access. */
import { applyPhotoEdit, type PhotoEdit } from '../../src/core/photoEdits';
import { toOklab } from '../../src/core/colourCheck';

export const FIT_KEYS = ['exposure', 'warmth', 'tint', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'colour'] as const;
export type FitKey = (typeof FIT_KEYS)[number];
export const FIT_BOUNDS: Record<FitKey, [number, number]> = {
  exposure: [-5, 5], warmth: [-3, 3], tint: [-3, 3], contrast: [-3, 3], highlights: [-3, 3],
  shadows: [-3, 3], whites: [-3, 3], blacks: [-3, 3], vibrance: [-3, 3], colour: [-1.9, 2],
};

export function vecToEdit(v: number[]): PhotoEdit {
  const e: Record<string, number> = {};
  FIT_KEYS.forEach((k, i) => { e[k] = v[i]; });
  return e as unknown as PhotoEdit;
}

/** Mean Oklab distance (lightness weighted 1, chroma 1) between two RGBA pictures of equal size, sampled. */
export function oklabLoss(a: Uint8ClampedArray, bLab: Float32Array, stride: number): number {
  let sum = 0, n = 0;
  for (let i = 0, j = 0; i < a.length; i += 4 * stride, j += 3) {
    const o = toOklab(a[i], a[i + 1], a[i + 2]);
    sum += Math.hypot(o[0] - bLab[j], o[1] - bLab[j + 1], o[2] - bLab[j + 2]); n += 1;
  }
  return sum / n;
}

export function labOf(p: Uint8ClampedArray, stride: number): Float32Array {
  const out = new Float32Array(Math.ceil(p.length / (4 * stride)) * 3);
  for (let i = 0, j = 0; i < p.length; i += 4 * stride, j += 3) {
    const o = toOklab(p[i], p[i + 1], p[i + 2]); out[j] = o[0]; out[j + 1] = o[1]; out[j + 2] = o[2];
  }
  return out;
}

/** Bounded Nelder-Mead. */
export function nelderMead(f: (x: number[]) => number, x0: number[], lo: number[], hi: number[], iters = 400, step = 0.5) {
  const n = x0.length, clamp = (x: number[]) => x.map((v, i) => Math.min(hi[i], Math.max(lo[i], v)));
  let pts = [clamp(x0)];
  for (let i = 0; i < n; i += 1) { const p = [...x0]; p[i] += step; pts.push(clamp(p)); }
  let vals = pts.map(f);
  for (let it = 0; it < iters; it += 1) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    pts = order.map((i) => pts[i]); vals = order.map((i) => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < 1e-6) break;
    const c = x0.map((_, d) => pts.slice(0, n).reduce((s, p) => s + p[d], 0) / n);
    const along = (t: number) => clamp(c.map((v, d) => v + t * (pts[n][d] - v)));
    const r = along(-1), fr = f(r);
    if (fr < vals[0]) {
      const e = along(-2), fe = f(e);
      if (fe < fr) { pts[n] = e; vals[n] = fe; } else { pts[n] = r; vals[n] = fr; }
    } else if (fr < vals[n - 1]) { pts[n] = r; vals[n] = fr; }
    else {
      const k = along(fr < vals[n] ? -0.5 : 0.5), fk = f(k);
      if (fk < Math.min(fr, vals[n])) { pts[n] = k; vals[n] = fk; }
      else for (let i = 1; i <= n; i += 1) { pts[i] = clamp(pts[i].map((v, d) => pts[0][d] + 0.5 * (v - pts[0][d]))); vals[i] = f(pts[i]); }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: pts[best], value: vals[best] };
}

const RIDGE = 0.0015;

export interface FitResult { edit: PhotoEdit; before: number; after: number }

/** Fit global sliders so tone(src) matches dst. Both are RGBA of equal size. */
export function fitGlobalEdit(src: Uint8ClampedArray, dst: Uint8ClampedArray, stride = 4): FitResult {
  const target = labOf(dst, stride);
  const sub = (() => { const o = new Uint8ClampedArray(Math.ceil(src.length / (4 * stride)) * 4); for (let i = 0, j = 0; i < src.length; i += 4 * stride, j += 4) { o[j] = src[i]; o[j + 1] = src[i + 1]; o[j + 2] = src[i + 2]; o[j + 3] = 255; } return o; })();
  const raw = (v: number[]) => { const w = new Uint8ClampedArray(sub); applyPhotoEdit(w, vecToEdit(v)); return oklabLoss(w, target, 1); };
  // Small ridge penalty keeps sliders near zero unless the picture really needs them (the problem is under-determined).
  const loss = (v: number[]) => raw(v) + RIDGE * v.reduce((t, x) => t + x * x, 0);
  const zero = FIT_KEYS.map(() => 0);
  // Two starts (neutral and a brightness-matched exposure) avoid the common local minimum.
  const meanL = (p: Uint8ClampedArray) => { let s = 0; for (let i = 0; i < p.length; i += 4) s += toOklab(p[i], p[i + 1], p[i + 2])[0]; return s / (p.length / 4); };
  const ratio = meanL(dst) / Math.max(1e-3, meanL(sub));
  const x1 = [...zero]; x1[0] = Math.max(-4, Math.min(4, Math.log2(Math.pow(ratio, 3)) / 0.4));
  const lo = FIT_KEYS.map((k) => FIT_BOUNDS[k][0]), hi = FIT_KEYS.map((k) => FIT_BOUNDS[k][1]);
  const a = nelderMead(loss, zero, lo, hi), b = nelderMead(loss, x1, lo, hi);
  const best = a.value <= b.value ? a : b;
  return { edit: vecToEdit(best.x), before: raw(zero), after: raw(best.x) };
}
