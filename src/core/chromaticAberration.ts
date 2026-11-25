/**
 * Lateral chromatic aberration (colour fringing), 25 Nov 2026. A lens bends red, green and blue light by slightly
 * different amounts, so towards the edges the red and blue pictures are a little larger or smaller than the green one,
 * which shows as red/cyan and blue/yellow fringes along contrasty edges. The correction scales the red and the blue
 * channel about the lens centre (the centre of the uncropped photo) to line them up with green again.
 *
 * The scale is a fraction of each pixel's distance from the centre, so it does not depend on resolution: the fit
 * preview, a zoomed view, a normal export and the 16-bit TIFF all move the channels by the same share of the photo.
 * It runs first, on the picture's own pixels, before noise reduction and tone. It does not touch longitudinal
 * (out-of-focus purple/green) fringing, which no channel shift can fix.
 */
import { cropRectangle, type PhotoFraming } from './photoFraming';

/**
 * -1 to 1 for each channel. Positive shrinks that channel's picture towards the centre (for a lens that draws it too
 * large, which shows as a fringe of that colour on the outer side of edges); negative enlarges it.
 */
export interface LateralCa { red: number; blue: number }

/** The largest correction at the end of a slider: 0.3% of the distance from the centre (about 7 px at the corner of a 45 MP frame). */
export const CA_MAX_SCALE = 0.003;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const validLateralCa = (value: unknown): value is LateralCa => typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.keys(value).every((key) => key === 'red' || key === 'blue')
  && finite((value as LateralCa).red) && Math.abs((value as LateralCa).red) <= 1
  && finite((value as LateralCa).blue) && Math.abs((value as LateralCa).blue) <= 1;
export const hasLateralCa = (value: unknown): value is LateralCa => validLateralCa(value) && (value.red !== 0 || value.blue !== 0);

/**
 * Where the lens centre sits in the framed photo, as fractions of the framed width and height. Turns and straighten
 * rotate about the picture's centre, so only the crop moves it. `extraTurns` matches frameRgb16's orientation fix.
 */
export function opticalCentre(width: number, height: number, framing: PhotoFraming, extraTurns = 0): { x: number; y: number } {
  const turns = (((framing.turns + extraTurns) % 4) + 4) % 4;
  const w = turns % 2 ? height : width, h = turns % 2 ? width : height;
  const crop = cropRectangle(w, h, framing);
  return { x: (w / 2 - crop.x) / crop.width, y: (h / 2 - crop.y) / crop.height };
}

/** Which part of the framed photo the buffer shows (as masks use it), and where the lens centre is in that photo. */
export interface CaPlacement {
  view?: { x: number; y: number; w: number; h: number };
  centre?: { x: number; y: number };
}

/**
 * Correct in place. `pixels` is interleaved (stride 3 or 4, alpha untouched), values 0..max. Bilinear resampling of
 * the red and blue channels; green, and every pixel's position, stay as they are.
 */
export function applyLateralCa<T extends Uint8ClampedArray | Uint16Array>(
  pixels: T, width: number, height: number, stride: number, ca: LateralCa | undefined, placement: CaPlacement = {},
): void {
  if (!hasLateralCa(ca) || width < 2 || height < 2) return;
  const view = placement.view ?? { x: 0, y: 0, w: 1, h: 1 };
  const centre = placement.centre ?? { x: 0.5, y: 0.5 };
  // The centre in this buffer's pixel coordinates (pixel centres at +0.5).
  const cx = ((centre.x - view.x) / view.w) * width - 0.5;
  const cy = ((centre.y - view.y) / view.h) * height - 0.5;
  const source = pixels.slice() as T;
  const round = pixels instanceof Uint8ClampedArray ? (v: number) => v : (v: number) => Math.round(v);
  for (const [channel, amount] of [[0, ca.red], [2, ca.blue]] as const) {
    if (amount === 0) continue;
    const scale = 1 + amount * CA_MAX_SCALE;
    for (let y = 0; y < height; y += 1) {
      const sy = Math.min(height - 1, Math.max(0, cy + (y - cy) * scale));
      const y0 = Math.floor(sy), y1 = Math.min(height - 1, y0 + 1), fy = sy - y0;
      for (let x = 0; x < width; x += 1) {
        const sx = Math.min(width - 1, Math.max(0, cx + (x - cx) * scale));
        const x0 = Math.floor(sx), x1 = Math.min(width - 1, x0 + 1), fx = sx - x0;
        const top = source[(y0 * width + x0) * stride + channel] * (1 - fx) + source[(y0 * width + x1) * stride + channel] * fx;
        const bottom = source[(y1 * width + x0) * stride + channel] * (1 - fx) + source[(y1 * width + x1) * stride + channel] * fx;
        pixels[(y * width + x) * stride + channel] = round(top * (1 - fy) + bottom * fy);
      }
    }
  }
}

/** Fewest strong edges, away from the centre, needed before a measurement is trusted. */
export const CA_MIN_EDGES = 400;
/** Candidate scales tried each side of zero; a parabola through the best three refines it. */
const STEPS = 15;
/** A measured shift smaller than this (in slider units) is reported as none. */
const DEAD_ZONE = 0.06;
/** Most edge points used: plenty for a stable answer, and quick on a phone. */
const MAX_EDGES = 6000;

export interface CaEstimate {
  /** The measured correction, or zeros when no clear fringing was found. */
  ca: LateralCa;
  /** Strong edges the measurement used. */
  edges: number;
  /** False when there were too few edges to measure; `ca` is then zeros and must not be applied as a finding. */
  measured: boolean;
}

/**
 * Measure lateral CA from the picture itself: on the strongest edges away from the centre, find the scale of red (and
 * of blue) that best matches green, by normalised correlation (so a coloured subject's own colour does not count as
 * fringing). Use the WHOLE uncropped picture, with no edit applied; the lens centre is then its centre.
 */
export function estimateLateralCa(pixels: Uint8ClampedArray | Uint16Array, width: number, height: number, stride: number): CaEstimate {
  const none = (edges: number, measured: boolean): CaEstimate => ({ ca: { red: 0, blue: 0 }, edges, measured });
  if (width < 32 || height < 32) return none(0, false);
  const cx = width / 2 - 0.5, cy = height / 2 - 0.5;
  const radius = Math.hypot(cx, cy);
  const green = (x: number, y: number) => pixels[(y * width + x) * stride + 1];
  // Radial gradient of green on a sparse grid, keeping the outer 70% of the radius where fringing is large enough to see.
  const max = pixels instanceof Uint8ClampedArray ? 255 : 65535;
  const threshold = max * 0.06;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 250_000)));
  const found: number[] = [];
  const strength: number[] = [];
  for (let y = 2; y < height - 2; y += step) {
    for (let x = 2; x < width - 2; x += step) {
      const dx = x - cx, dy = y - cy;
      const r = Math.hypot(dx, dy);
      if (r < radius * 0.3) continue;
      const gx = green(x + 1, y) - green(x - 1, y), gy = green(x, y + 1) - green(x, y - 1);
      const radial = Math.abs((gx * dx + gy * dy) / r);
      if (radial > threshold) { found.push(y * width + x); strength.push(radial); }
    }
  }
  if (found.length < CA_MIN_EDGES) return none(found.length, false);
  // The strongest edges, spread over the frame: keep at most MAX_EDGES.
  const order = Array.from(found.keys());
  if (order.length > MAX_EDGES) order.sort((a, b) => strength[b] - strength[a]).length = MAX_EDGES;
  const edges = order.length;
  // A small neighbourhood around each edge point, so the correlation sees both sides of the edge.
  const count = edges * 9;
  const px = new Float32Array(count), py = new Float32Array(count), greens = new Float32Array(count);
  let n = 0, meanG = 0;
  for (const k of order) {
    const x = found[k] % width, y = (found[k] - x) / width;
    for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) {
      px[n] = x + ox - cx; py[n] = y + oy - cy; greens[n] = green(x + ox, y + oy); meanG += greens[n]; n += 1;
    }
  }
  meanG /= count;
  let g2 = 0;
  for (let i = 0; i < count; i += 1) { greens[i] -= meanG; g2 += greens[i] * greens[i]; }
  const values = new Float32Array(count);
  const correlation = (channel: number, amount: number) => {
    const scale = 1 + amount * CA_MAX_SCALE;
    let mean = 0;
    for (let i = 0; i < count; i += 1) {
      const sx = Math.min(width - 1, Math.max(0, cx + px[i] * scale)), sy = Math.min(height - 1, Math.max(0, cy + py[i] * scale));
      const x0 = sx | 0, y0 = sy | 0, x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
      const fx = sx - x0, fy = sy - y0;
      const a = pixels[(y0 * width + x0) * stride + channel], b = pixels[(y0 * width + x1) * stride + channel];
      const c = pixels[(y1 * width + x0) * stride + channel], d = pixels[(y1 * width + x1) * stride + channel];
      const v = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
      values[i] = v; mean += v;
    }
    mean /= count;
    let num = 0, a2 = 0;
    for (let i = 0; i < count; i += 1) { const a = values[i] - mean; num += a * greens[i]; a2 += a * a; }
    return a2 > 0 && g2 > 0 ? num / Math.sqrt(a2 * g2) : 0;
  };
  const best = (channel: number): number => {
    const scores = Array.from({ length: 2 * STEPS + 1 }, (_, i) => correlation(channel, (i - STEPS) / STEPS));
    let top = 0;
    for (let i = 1; i < scores.length; i += 1) if (scores[i] > scores[top]) top = i;
    let amount = (top - STEPS) / STEPS;
    if (top > 0 && top < scores.length - 1) {
      const [l, m, r] = [scores[top - 1], scores[top], scores[top + 1]];
      const curve = l - 2 * m + r;
      if (curve < 0) amount += (0.5 * (l - r) / curve) / STEPS;
    }
    amount = Math.max(-1, Math.min(1, amount));
    return Math.abs(amount) < DEAD_ZONE ? 0 : Math.round(amount * 100) / 100;
  };
  return { ca: { red: best(0), blue: best(2) }, edges, measured: true };
}
