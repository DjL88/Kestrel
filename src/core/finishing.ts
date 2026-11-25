/**
 * Finishing effects (advanced controls, 25 Nov 2026): vignette and grain. They depend on where a pixel sits in the
 * framed photo, so they run as a last pass after tone, detail and masks, in framed-photo coordinates (the same view
 * rectangle masks use). The fit preview, a zoomed strip, a normal export and the 16-bit TIFF therefore agree: the
 * vignette follows the framing, and grain is anchored to the photo rather than to screen pixels.
 */
import type { MaskContext } from './masks';

/**
 * amount: -1 darkens the edges, 1 lightens them; with `colour`, the edges blend towards that colour by |amount|.
 * size (the midpoint): 0 keeps it to the corners, 1 reaches well into the picture. blur: 0 to 1 softens the edges.
 * roundness: -1 follows the frame's rectangle, 0 (absent) an oval of the frame's shape, 1 a circle.
 * feather: 0 a hard edge, 0.5 (absent) the standard soft fall-off, 1 the softest.
 * highlights: 0 (absent) to 1, how much bright areas are spared from darkening or tinting.
 */
export interface Vignette {
  amount: number; size: number; colour?: [number, number, number]; blur?: number;
  roundness?: number; feather?: number; highlights?: number;
}
/** roughness: 0 (absent) smooth, even grain; 1 adds a finer, irregular layer, like coarse film. */
export interface Grain { amount: number; size: number; roughness?: number }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const unit = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;
const VIGNETTE_KEYS = new Set(['amount', 'size', 'colour', 'blur', 'roundness', 'feather', 'highlights']);
export const validVignette = (value: unknown): value is Vignette => record(value)
  && Object.keys(value).every((k) => VIGNETTE_KEYS.has(k))
  && finite(value.amount) && value.amount >= -1 && value.amount <= 1 && unit(value.size)
  && (value.blur === undefined || unit(value.blur))
  && (value.roundness === undefined || (finite(value.roundness) && value.roundness >= -1 && value.roundness <= 1))
  && (value.feather === undefined || unit(value.feather)) && (value.highlights === undefined || unit(value.highlights))
  && (value.colour === undefined || (Array.isArray(value.colour) && value.colour.length === 3 && value.colour.every(unit)));
const vignetteOn = (v: Vignette) => v.amount !== 0 || (v.blur ?? 0) > 0;
export const validGrain = (value: unknown): value is Grain => record(value) && Object.keys(value).every((k) => k === 'amount' || k === 'size' || k === 'roughness')
  && finite(value.amount) && value.amount >= 0 && value.amount <= 1 && finite(value.size) && value.size >= 0 && value.size <= 1
  && (value.roughness === undefined || unit(value.roughness));

interface FinishEdit { vignette?: Vignette; grain?: Grain }
export function hasFinishing(edit: FinishEdit): boolean {
  return (validVignette(edit.vignette) && vignetteOn(edit.vignette)) || (validGrain(edit.grain) && edit.grain.amount > 0);
}

/** A vignette at full strength darkens or lightens the corners by this many stops. */
export const VIGNETTE_STOPS = 2;
/** Grain cells across the photo's long edge, from finest (size 0) to coarsest (size 1). */
const GRAIN_CELLS_FINE = 1600;
const GRAIN_CELLS_COARSE = 320;
/** Largest grain swing in display values at full amount, in the midtones. */
const GRAIN_STRENGTH = 0.09;

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toEncoded = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const smoothstep = (low: number, high: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/** Deterministic hash of a lattice point to 0..1, identical on every platform. */
function lattice(ix: number, iy: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Smooth value noise, -1 to 1. */
export function grainNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = lattice(ix, iy), b = lattice(ix + 1, iy), c = lattice(ix, iy + 1), d = lattice(ix + 1, iy + 1);
  return ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy) * 2 - 1;
}

/** Largest edge blur radius, as a share of the photo's long edge. */
export const VIGNETTE_BLUR_EDGE = 0.02;

/** The narrowest fall-off a feather of 0 gives, as a share of the distance from centre to corner. */
const HARDEST_FALLOFF = 0.02;

interface Plan {
  vignette: {
    stops: number; start: number; end: number; colour: [number, number, number] | null; mix: number;
    roundness: number; highlights: number; circle: number;
  } | null;
  blurRadius: number;
  grain: { amount: number; cells: number; roughness: number } | null;
  fx0: number; fy0: number; fdx: number; fdy: number; longW: number; longH: number;
}

function plan(edit: FinishEdit, width: number, height: number, context: MaskContext, imageEdge: number): Plan {
  const { aspect, view } = context;
  const v = validVignette(edit.vignette) && vignetteOn(edit.vignette) ? edit.vignette : null;
  const longW = aspect <= 1 ? 1 : 1 / aspect, longH = aspect <= 1 ? aspect : 1;
  const start = v ? 0.8 - 0.65 * v.size : 1;
  // Feather 0.5 (and absent) is the original fall-off from `start` to the corner; 0 is nearly hard, 1 twice as wide.
  const falloff = v ? Math.max(HARDEST_FALLOFF, (1 - start) * 2 * (v.feather ?? 0.5)) : 0;
  const vignette = v ? {
    stops: v.colour ? 0 : v.amount * VIGNETTE_STOPS, start, end: start + falloff,
    colour: v.colour ? v.colour.map(toLinear) as [number, number, number] : null, mix: v.colour ? Math.abs(v.amount) : 0,
    roundness: v.roundness ?? 0, highlights: v.highlights ?? 0,
    // A circle in real proportions, scaled so its corner distance is 1 like the oval's.
    circle: 1 / Math.hypot(longW, longH),
  } : null;
  const blurRadius = v && (v.blur ?? 0) > 0 ? Math.max(0.5, (v.blur ?? 0) * VIGNETTE_BLUR_EDGE * imageEdge) : 0;
  let grain: Plan['grain'] = null;
  if (validGrain(edit.grain) && edit.grain.amount > 0) {
    const cells = GRAIN_CELLS_FINE + (GRAIN_CELLS_COARSE - GRAIN_CELLS_FINE) * edit.grain.size;
    // When a grain cell is smaller than a screen pixel, independent cells average out: scale the swing down to match.
    const cellPixels = imageEdge / cells;
    grain = { amount: edit.grain.amount * GRAIN_STRENGTH * Math.min(1, cellPixels), cells, roughness: edit.grain.roughness ?? 0 };
  }
  return {
    vignette, grain, blurRadius,
    fx0: view.x, fy0: view.y, fdx: view.w / width, fdy: view.h / height,
    longW, longH,
  };
}

/**
 * One pixel: display-encoded 0..1 in `out`, changed in place. fx, fy are 0..1 across the framed photo. `soft` is the
 * same pixel from the blurred copy (only when the vignette blurs).
 */
function finishPixel(out: Float32Array, fx: number, fy: number, p: Plan, soft: Float32Array | null): void {
  if (p.vignette) {
    const u = 2 * fx - 1, v = 2 * fy - 1;
    const { roundness } = p.vignette;
    let distance = Math.sqrt((u * u + v * v) / 2);
    if (roundness > 0) {
      const circle = Math.hypot(u * p.longW, v * p.longH) * p.vignette.circle;
      distance += (circle - distance) * roundness;
    } else if (roundness < 0) {
      // Towards the frame's own rectangle: every edge, not only the corners, reaches the full distance.
      distance += (Math.max(Math.abs(u), Math.abs(v)) - distance) * -roundness;
    }
    let weight = smoothstep(p.vignette.start, p.vignette.end, distance);
    const { stops, colour, mix, highlights } = p.vignette;
    // Spare bright areas from darkening or tinting (lightening is left as it is).
    if (weight > 0 && highlights > 0 && (stops < 0 || colour)) {
      const luma = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
      weight *= 1 - highlights * smoothstep(0.55, 0.95, luma);
    }
    if (weight > 0) {
      const gain = 2 ** (stops * weight);
      for (let c = 0; c < 3; c += 1) {
        let light = toLinear(out[c]);
        if (soft) light += (toLinear(soft[c]) - light) * weight;
        if (colour) light += (colour[c] - light) * mix * weight;
        out[c] = toEncoded(light * gain);
      }
    }
  }
  if (p.grain) {
    const luma = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
    const gx = fx * p.longW * p.grain.cells, gy = fy * p.longH * p.grain.cells;
    let noise = grainNoise(gx, gy);
    // Roughness mixes in a finer, offset layer, so the grain is less even (still fixed to the photo).
    if (p.grain.roughness > 0) noise = noise * (1 - 0.45 * p.grain.roughness) + 0.75 * p.grain.roughness * grainNoise(gx * 2.7 + 101.3, gy * 2.7 + 57.9);
    const delta = p.grain.amount * (0.35 + 2.6 * luma * (1 - luma)) * noise;
    for (let c = 0; c < 3; c += 1) out[c] = Math.min(1, Math.max(0, out[c] + delta));
  }
}

/** Three box blurs (close to a Gaussian) of the colour channels of an interleaved image; alpha is left alone. */
export function blurInterleaved<T extends Uint8ClampedArray | Uint16Array>(source: T, width: number, height: number, stride: number, radius: number): T {
  const out = source.slice() as T;
  const r = Math.max(1, Math.round(radius / Math.sqrt(3)));
  const line = new Float32Array(Math.max(width, height));
  const pass = (length: number, count: number, at: (line: number, i: number) => number) => {
    for (let l = 0; l < count; l += 1) {
      for (let c = 0; c < 3; c += 1) {
        for (let i = 0; i < length; i += 1) line[i] = out[at(l, i) + c];
        let sum = 0;
        for (let i = -r; i <= r; i += 1) sum += line[Math.min(length - 1, Math.max(0, i))];
        for (let i = 0; i < length; i += 1) {
          out[at(l, i) + c] = sum / (2 * r + 1);
          sum += line[Math.min(length - 1, i + r + 1)] - line[Math.max(0, i - r)];
        }
      }
    }
  };
  for (let k = 0; k < 3; k += 1) {
    pass(width, height, (y, x) => (y * width + x) * stride);
    pass(height, width, (x, y) => (y * width + x) * stride);
  }
  return out;
}

/** 8-bit RGBA, as on a canvas. */
export function applyFinishing(pixels: Uint8ClampedArray, width: number, height: number, edit: FinishEdit, context: MaskContext, imageEdge = Math.max(width, height)): void {
  if (!hasFinishing(edit)) return;
  const p = plan(edit, width, height, context, imageEdge);
  const out = new Float32Array(3);
  const blurred = p.blurRadius ? blurInterleaved(pixels, width, height, 4, p.blurRadius) : null;
  const soft = blurred ? new Float32Array(3) : null;
  for (let y = 0; y < height; y += 1) {
    const fy = p.fy0 + (y + 0.5) * p.fdy;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      out[0] = pixels[i] / 255; out[1] = pixels[i + 1] / 255; out[2] = pixels[i + 2] / 255;
      if (blurred && soft) { soft[0] = blurred[i] / 255; soft[1] = blurred[i + 1] / 255; soft[2] = blurred[i + 2] / 255; }
      finishPixel(out, p.fx0 + (x + 0.5) * p.fdx, fy, p, soft);
      pixels[i] = Math.round(out[0] * 255); pixels[i + 1] = Math.round(out[1] * 255); pixels[i + 2] = Math.round(out[2] * 255);
    }
  }
}

/** Display-encoded 16-bit RGB holding the whole framed photo (the TIFF master). */
export function applyFinishingRgb16(data: Uint16Array, width: number, height: number, edit: FinishEdit): void {
  if (!hasFinishing(edit)) return;
  const p = plan(edit, width, height, { aspect: height / width, view: { x: 0, y: 0, w: 1, h: 1 } }, Math.max(width, height));
  const out = new Float32Array(3);
  const blurred = p.blurRadius ? blurInterleaved(data, width, height, 3, p.blurRadius) : null;
  const soft = blurred ? new Float32Array(3) : null;
  for (let y = 0; y < height; y += 1) {
    const fy = (y + 0.5) * p.fdy;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      out[0] = data[i] / 65535; out[1] = data[i + 1] / 65535; out[2] = data[i + 2] / 65535;
      if (blurred && soft) { soft[0] = blurred[i] / 65535; soft[1] = blurred[i + 1] / 65535; soft[2] = blurred[i + 2] / 65535; }
      finishPixel(out, (x + 0.5) * p.fdx, fy, p, soft);
      data[i] = Math.round(out[0] * 65535); data[i + 1] = Math.round(out[1] * 65535); data[i + 2] = Math.round(out[2] * 65535);
    }
  }
}
