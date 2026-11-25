/**
 * Colour fringe removal (25 Nov 2026), the two kinds a lens leaves:
 * - Lateral chromatic aberration: the lens makes red and blue images very slightly larger or smaller than green, so
 *   edges towards the corners get red/cyan or blue/yellow outlines. Corrected by rescaling the red and blue channels
 *   about the lens's centre (the centre of the original photo, wherever the crop sits). `detectLateralCa` measures it.
 * - Purple and green fringes (axial aberration): coloured halos on high-contrast edges anywhere in the frame, e.g.
 *   branches against a bright sky. Removed by taking the colour out of purple or green pixels next to a strong edge.
 * Both run first, on the picture's own pixels, so every later step sees clean edges. Pure; same maths at any size.
 */
import type { MaskContext } from './masks';

export interface LateralCa {
  /** -1..1: red channel scale against green; 1 shrinks red by MAX_SCALE. */
  red: number;
  blue: number;
}
export interface Defringe {
  /** 0..1 */
  purple: number;
  green: number;
}
export interface FringeEdit {
  lateralCa?: LateralCa;
  defringe?: Defringe;
}

/** Largest scale difference corrected: 0.2% of the radius, about 7 pixels in the corner of a 24-megapixel photo. */
export const MAX_CA_SCALE = 0.002;
/** Edge search radius, as a share of the photo's long edge. */
const EDGE_RADIUS = 1 / 1200;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const within = (v: unknown, low: number, high: number) => finite(v) && v >= low && v <= high;

export function validLateralCa(value: unknown): value is LateralCa {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return within(v.red, -1, 1) && within(v.blue, -1, 1);
}
export function validDefringe(value: unknown): value is Defringe {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return within(v.purple, 0, 1) && within(v.green, 0, 1);
}

export const hasLateralCa = (edit: FringeEdit) => !!edit.lateralCa && (edit.lateralCa.red !== 0 || edit.lateralCa.blue !== 0);
export const hasDefringe = (edit: FringeEdit) => !!edit.defringe && (edit.defringe.purple > 0 || edit.defringe.green > 0);
export const hasFringeEdit = (edit: FringeEdit) => hasLateralCa(edit) || hasDefringe(edit);

/** Where the lens's centre falls on a canvas, in that canvas's pixels. */
export function canvasLensCentre(width: number, height: number, context?: MaskContext): [number, number] {
  const view = context?.view ?? { x: 0, y: 0, w: 1, h: 1 };
  const lens = context?.lensCentre ?? { x: 0.5, y: 0.5 };
  return [((lens.x - view.x) / view.w) * width, ((lens.y - view.y) / view.h) * height];
}

function sample(pixels: ArrayLike<number>, width: number, height: number, stride: number, channel: number, x: number, y: number): number {
  const fx = Math.min(width - 1, Math.max(0, x - 0.5));
  const fy = Math.min(height - 1, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = pixels[(y0 * width + x0) * stride + channel], b = pixels[(y0 * width + x1) * stride + channel];
  const c = pixels[(y1 * width + x0) * stride + channel], d = pixels[(y1 * width + x1) * stride + channel];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/** Catmull-Rom weights for a fractional offset t, taps at -1, 0, 1, 2. Sharper than bilinear, so moving a channel by
 * a fraction of a pixel does not soften it against the others. */
function cubicWeights(t: number, out: Float32Array, at: number): void {
  const t2 = t * t, t3 = t2 * t;
  out[at] = -0.5 * t3 + t2 - 0.5 * t;
  out[at + 1] = 1.5 * t3 - 2.5 * t2 + 1;
  out[at + 2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  out[at + 3] = 0.5 * t3 - 0.5 * t2;
}

/** For each output index, the first source tap and four weights of a scale by (1 + m) about `centre`. */
function scaleTaps(length: number, centre: number, m: number): { first: Int32Array; weights: Float32Array } {
  const first = new Int32Array(length), weights = new Float32Array(length * 4);
  for (let i = 0; i < length; i += 1) {
    const f = centre + (i + 0.5 - centre) * (1 + m) - 0.5;
    const i0 = Math.floor(f);
    first[i] = i0 - 1;
    cubicWeights(f - i0, weights, i * 4);
  }
  return { first, weights };
}

/**
 * Rescale red and blue about the lens centre (cx, cy in canvas pixels). In place. A scale about a point is separable,
 * so each channel is resampled across, then down.
 */
export function applyLateralCa(pixels: Uint8ClampedArray | Uint16Array, width: number, height: number, stride: 3 | 4, ca: LateralCa | undefined, cx: number, cy: number): void {
  if (!ca || !validLateralCa(ca) || (ca.red === 0 && ca.blue === 0) || !width || !height) return;
  const max = pixels instanceof Uint16Array ? 65535 : 255;
  const across = new Float32Array(width * height);
  for (const [channel, amount] of [[0, ca.red], [2, ca.blue]] as const) {
    if (amount === 0) continue;
    // A channel drawn (1 + m) times too large is read back from (1 + m) times further out.
    const m = amount * MAX_CA_SCALE;
    const tx = scaleTaps(width, cx, m), ty = scaleTaps(height, cy, m);
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        const f = tx.first[x], w = x * 4;
        let sum = 0;
        for (let k = 0; k < 4; k += 1) sum += tx.weights[w + k] * pixels[(row + Math.min(width - 1, Math.max(0, f + k))) * stride + channel];
        across[row + x] = sum;
      }
    }
    for (let y = 0; y < height; y += 1) {
      const f = ty.first[y], w = y * 4;
      const r0 = Math.min(height - 1, Math.max(0, f)) * width, r1 = Math.min(height - 1, Math.max(0, f + 1)) * width;
      const r2 = Math.min(height - 1, Math.max(0, f + 2)) * width, r3 = Math.min(height - 1, Math.max(0, f + 3)) * width;
      const w0 = ty.weights[w], w1 = ty.weights[w + 1], w2 = ty.weights[w + 2], w3 = ty.weights[w + 3];
      for (let x = 0; x < width; x += 1) {
        const v = w0 * across[r0 + x] + w1 * across[r1 + x] + w2 * across[r2 + x] + w3 * across[r3 + x];
        pixels[(y * width + x) * stride + channel] = Math.round(v < 0 ? 0 : v > max ? max : v);
      }
    }
  }
}

/** Separable max - min of a plane over a square window: the local tonal range. */
function localRange(plane: Float32Array, width: number, height: number, r: number): Float32Array {
  const hiH = new Float32Array(plane.length), loH = new Float32Array(plane.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      let hi = -Infinity, lo = Infinity;
      for (let k = Math.max(0, x - r); k <= Math.min(width - 1, x + r); k += 1) { const v = plane[row + k]; if (v > hi) hi = v; if (v < lo) lo = v; }
      hiH[row + x] = hi; loH[row + x] = lo;
    }
  }
  const out = new Float32Array(plane.length);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let hi = -Infinity, lo = Infinity;
      for (let k = Math.max(0, y - r); k <= Math.min(height - 1, y + r); k += 1) {
        const p = k * width + x;
        if (hiH[p] > hi) hi = hiH[p];
        if (loH[p] < lo) lo = loH[p];
      }
      out[y * width + x] = hi - lo;
    }
  }
  return out;
}

const smooth = (low: number, high: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low)));
  return t * t * (3 - 2 * t);
};
/** 1 inside the band, fading to 0 over `feather` degrees outside it. */
function hueBand(hue: number, centre: number, half: number, feather: number): number {
  const d = Math.abs(((hue - centre + 540) % 360) - 180);
  return 1 - smooth(half, half + feather, d);
}

/** Purple fringes: hues from violet to magenta. Green fringes: yellow-green to green-cyan. */
const PURPLE = { centre: 285, half: 35, feather: 20 };
const GREEN = { centre: 120, half: 40, feather: 20 };

/** Take the colour out of purple or green pixels next to a strong edge. In place; luminance is kept. */
export function applyDefringe(pixels: Uint8ClampedArray | Uint16Array, width: number, height: number, stride: 3 | 4, defringe: Defringe | undefined, imageEdge = Math.max(width, height)): void {
  if (!defringe || !validDefringe(defringe) || (defringe.purple === 0 && defringe.green === 0) || !width || !height) return;
  const max = pixels instanceof Uint16Array ? 65535 : 255;
  const count = width * height;
  const luma = new Float32Array(count);
  for (let p = 0, i = 0; p < count; p += 1, i += stride) luma[p] = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / max;
  const range = localRange(luma, width, height, Math.max(2, Math.round(EDGE_RADIUS * imageEdge * 3)));
  for (let p = 0, i = 0; p < count; p += 1, i += stride) {
    const edge = smooth(0.18, 0.4, range[p]);
    if (edge <= 0) continue;
    const r = pixels[i] / max, g = pixels[i + 1] / max, b = pixels[i + 2] / max;
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b), chroma = hi - lo;
    if (chroma < 0.03) continue;
    let hue: number;
    if (hi === r) hue = 60 * (((g - b) / chroma + 6) % 6);
    else if (hi === g) hue = 60 * ((b - r) / chroma + 2);
    else hue = 60 * ((r - g) / chroma + 4);
    const strength = Math.min(1, edge * smooth(0.03, 0.12, chroma) * Math.max(
      defringe.purple * hueBand(hue, PURPLE.centre, PURPLE.half, PURPLE.feather),
      defringe.green * hueBand(hue, GREEN.centre, GREEN.half, GREEN.feather),
    ));
    if (strength <= 0) continue;
    const y = luma[p];
    pixels[i] = Math.round(Math.min(1, Math.max(0, r + (y - r) * strength)) * max);
    pixels[i + 1] = Math.round(Math.min(1, Math.max(0, g + (y - g) * strength)) * max);
    pixels[i + 2] = Math.round(Math.min(1, Math.max(0, b + (y - b) * strength)) * max);
  }
}

/** Both corrections, lateral first (so the defringe sees edges in register). */
export function applyFringe(pixels: Uint8ClampedArray | Uint16Array, width: number, height: number, stride: 3 | 4, edit: FringeEdit, context?: MaskContext, imageEdge = Math.max(width, height)): void {
  if (!hasFringeEdit(edit)) return;
  const [cx, cy] = canvasLensCentre(width, height, context);
  applyLateralCa(pixels, width, height, stride, edit.lateralCa, cx, cy);
  applyDefringe(pixels, width, height, stride, edit.defringe, imageEdge);
}

/** Long edge of the copy lateral aberration is measured on. */
const DETECT_EDGE = 1200;
const DETECT_STEPS = 40;

/**
 * Measure lateral aberration: for red and blue in turn, the scale that best lines the channel's edges up with green's
 * at neutral (grey, black or white) edges away from the centre. Returns slider values (-1..1, to 0.05), or null when
 * it cannot tell: too few such edges, or parts of the frame that disagree (a coloured edge, not the lens). Measured
 * once and stored, so preview and export use the same numbers.
 */
export function detectLateralCa(pixels: Uint8ClampedArray | Uint16Array, width: number, height: number, stride: 3 | 4, cx = width / 2, cy = height / 2): LateralCa | null {
  const max = pixels instanceof Uint16Array ? 65535 : 255;
  const step = Math.max(1, Math.ceil(Math.max(width, height) / DETECT_EDGE));
  const w = Math.floor(width / step), h = Math.floor(height / step);
  if (w < 64 || h < 64) return null;
  const small = new Float32Array(w * h * 3);
  const unit = 1 / (max * step * step);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < step; j += 1) for (let k = 0; k < step; k += 1) {
      const i = ((y * step + j) * width + x * step + k) * stride;
      r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2];
    }
    const o = (y * w + x) * 3;
    small[o] = r * unit; small[o + 1] = g * unit; small[o + 2] = b * unit;
  }
  const scx = cx / step, scy = cy / step;
  const half = Math.hypot(Math.max(scx, w - scx), Math.max(scy, h - scy));
  const neutral = (x: number, y: number) => {
    const o = (Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))) * 3;
    return Math.abs(small[o] - small[o + 1]) < 0.08 && Math.abs(small[o + 2] - small[o + 1]) < 0.08;
  };
  // Edge points: a clear green step along the radius (tangential edges show no lateral shift), away from the centre,
  // with grey on both sides, so a coloured object's own edge is not taken for the lens.
  const points: number[] = [];
  const sectors = [0, 0, 0, 0];
  for (let y = 3; y < h - 3; y += 1) for (let x = 3; x < w - 3; x += 1) {
    const dx = x + 0.5 - scx, dy = y + 0.5 - scy, rad = Math.hypot(dx, dy);
    if (rad < half * 0.35) continue;
    const ux = dx / rad, uy = dy / rad;
    const radial = Math.abs(sample(small, w, h, 3, 1, x + 0.5 + ux, y + 0.5 + uy) - sample(small, w, h, 3, 1, x + 0.5 - ux, y + 0.5 - uy));
    if (radial < 0.15 || !neutral(x + 3 * ux, y + 3 * uy) || !neutral(x - 3 * ux, y - 3 * uy)) continue;
    points.push(y * w + x);
    sectors[Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 1) : (dy > 0 ? 2 : 3)] += 1;
  }
  if (points.length < 200 || sectors.filter((n) => n >= 40).length < 2) return null;
  const pick = points.length > 20000 ? points.filter((_, i) => i % Math.ceil(points.length / 20000) === 0) : points;
  const measure = (channel: number, subset: number[]): { best: number; gain: number } => {
    const cost = (s: number): number => {
      const m = (s / DETECT_STEPS) * MAX_CA_SCALE;
      let total = 0;
      for (const p of subset) {
        const x = p % w, y = (p - x) / w;
        const dx = x + 0.5 - scx, dy = y + 0.5 - scy;
        const rad = Math.hypot(dx, dy) || 1, ux = dx / rad, uy = dy / rad;
        // Compare steps across the radius, not levels.
        const at = (o: number) => sample(small, w, h, 3, channel, scx + (dx + o * ux) * (1 + m), scy + (dy + o * uy) * (1 + m));
        const gg = sample(small, w, h, 3, 1, x + 0.5 + ux, y + 0.5 + uy) - sample(small, w, h, 3, 1, x + 0.5 - ux, y + 0.5 - uy);
        total += Math.abs(at(1) - at(-1) - gg);
      }
      return total;
    };
    // Coarse search, then the neighbourhood of the best; ties go to the smaller correction.
    const zero = cost(0);
    let best = 0, bestCost = zero;
    const tryStep = (s: number) => {
      if (s < -DETECT_STEPS || s > DETECT_STEPS || s === best) return;
      const c = cost(s);
      if (c < bestCost - 1e-9 || (Math.abs(c - bestCost) <= 1e-9 && Math.abs(s) < Math.abs(best))) { bestCost = c; best = s; }
    };
    for (let s = -DETECT_STEPS; s <= DETECT_STEPS; s += 4) tryStep(s);
    const coarse = best;
    for (let s = coarse - 3; s <= coarse + 3; s += 1) tryStep(s);
    return { best, gain: zero > 0 ? 1 - bestCost / zero : 0 };
  };
  const result: LateralCa = { red: 0, blue: 0 };
  for (const [channel, key] of [[0, 'red'], [2, 'blue']] as const) {
    const all = measure(channel, pick);
    // Too small a gain is noise, not the lens: leave it alone.
    if (all.best === 0 || all.gain < 0.05) continue;
    // The lens shifts every side of the frame the same way; one coloured edge does not.
    for (let sector = 0; sector < 4; sector += 1) {
      if (sectors[sector] < 40) continue;
      const own = measure(channel, pick.filter((p) => {
        const x = p % w, y = (p - x) / w, dx = x + 0.5 - scx, dy = y + 0.5 - scy;
        return (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 1) : (dy > 0 ? 2 : 3)) === sector;
      }));
      if (Math.sign(own.best) === -Math.sign(all.best)) return null;
    }
    result[key] = Math.round((all.best / DETECT_STEPS) * 20) / 20;
  }
  return result;
}
