import { applyPhotoEdit, type PhotoEdit } from './photoEdits';
import { LOCAL_KEYS, hasActiveMasks, type Mask } from './maskTypes';

/** Which part of the framed photo a canvas shows. A zoomed region covers a sub-rectangle. */
export interface MaskContext {
  /** Height divided by width of the whole framed photo. */
  aspect: number;
  view: { x: number; y: number; w: number; h: number };
}

export const fullContext = (width: number, height: number): MaskContext => ({
  aspect: height / width, view: { x: 0, y: 0, w: 1, h: 1 },
});

const smoothstep = (low: number, high: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low || 1e-6)));
  return t * t * (3 - 2 * t);
};

const BRUSH_WIDTH = 384;
const brushCache = new WeakMap<Mask, { aspect: number; rows: number; grid: Float32Array }>();

function brushGrid(mask: Extract<Mask, { kind: 'brush' }>, aspect: number) {
  const cached = brushCache.get(mask);
  if (cached && cached.aspect === aspect) return cached;
  const rows = Math.max(1, Math.round(BRUSH_WIDTH * aspect));
  const grid = new Float32Array(BRUSH_WIDTH * rows);
  const dab = (cx: number, cy: number, radius: number, erase: boolean) => {
    const rGrid = radius * BRUSH_WIDTH;
    const x0 = Math.max(0, Math.floor(cx * BRUSH_WIDTH - rGrid));
    const x1 = Math.min(BRUSH_WIDTH - 1, Math.ceil(cx * BRUSH_WIDTH + rGrid));
    const y0 = Math.max(0, Math.floor(cy * rows - rGrid));
    const y1 = Math.min(rows - 1, Math.ceil(cy * rows + rGrid));
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const d = Math.hypot(x + 0.5 - cx * BRUSH_WIDTH, y + 0.5 - cy * rows) / rGrid;
      if (d >= 1) continue;
      const strength = 1 - smoothstep(0.45, 1, d);
      const index = y * BRUSH_WIDTH + x;
      grid[index] = erase ? grid[index] * (1 - strength) : Math.max(grid[index], strength);
    }
  };
  for (const stroke of mask.strokes) {
    const { points, radius, erase } = stroke;
    if (points.length < 2) continue;
    dab(points[0], points[1], radius, erase);
    const spacing = Math.max(radius * 0.3, 0.002);
    for (let i = 2; i < points.length; i += 2) {
      const dx = points[i] - points[i - 2];
      const dy = (points[i + 1] - points[i - 1]) * aspect;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / spacing));
      for (let s = 1; s <= steps; s += 1) {
        const t = s / steps;
        dab(points[i - 2] + (points[i] - points[i - 2]) * t, points[i - 1] + (points[i + 1] - points[i - 1]) * t, radius, erase);
      }
    }
  }
  const made = { aspect, rows, grid };
  brushCache.set(mask, made);
  return made;
}

function sampleBrush(made: { rows: number; grid: Float32Array }, nx: number, ny: number): number {
  const fx = Math.min(BRUSH_WIDTH - 1.001, Math.max(0, nx * BRUSH_WIDTH - 0.5));
  const fy = Math.min(made.rows - 1.001, Math.max(0, ny * made.rows - 0.5));
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  const tx = fx - x;
  const ty = fy - y;
  const at = (xx: number, yy: number) => made.grid[Math.min(made.rows - 1, yy) * BRUSH_WIDTH + Math.min(BRUSH_WIDTH - 1, xx)];
  return (at(x, y) * (1 - tx) + at(x + 1, y) * tx) * (1 - ty) + (at(x, y + 1) * (1 - tx) + at(x + 1, y + 1) * tx) * ty;
}

/** Mask strength, 0 to 1, for every pixel of a canvas that shows `context.view`. */
export function maskAlpha(mask: Mask, width: number, height: number, context: MaskContext): Float32Array {
  const alpha = new Float32Array(width * height);
  const { aspect, view } = context;
  const brush = mask.kind === 'brush' ? brushGrid(mask, aspect) : null;
  let dx = 0;
  let dy = 0;
  let lengthSquared = 1;
  let inner = 0;
  let low = 0;
  let high = 1;
  if (mask.kind === 'linear') {
    dx = mask.x2 - mask.x1;
    dy = (mask.y2 - mask.y1) * aspect;
    lengthSquared = Math.max(dx * dx + dy * dy, 1e-9);
    const width01 = 0.05 + 0.95 * mask.feather;
    low = 0.5 - width01 / 2;
    high = 0.5 + width01 / 2;
  }
  if (mask.kind === 'radial') inner = Math.min(0.999, 1 - mask.feather);
  for (let y = 0; y < height; y += 1) {
    const ny = view.y + ((y + 0.5) / height) * view.h;
    for (let x = 0; x < width; x += 1) {
      const nx = view.x + ((x + 0.5) / width) * view.w;
      let a: number;
      if (mask.kind === 'linear') {
        const t = ((nx - mask.x1) * dx + (ny - mask.y1) * aspect * dy) / lengthSquared;
        a = 1 - smoothstep(low, high, t);
      } else if (mask.kind === 'radial') {
        const d = Math.hypot((nx - mask.cx) / mask.rx, ((ny - mask.cy) * aspect) / mask.ry);
        a = 1 - smoothstep(inner, 1, d);
      } else {
        a = sampleBrush(brush!, nx, ny);
      }
      alpha[y * width + x] = mask.invert ? 1 - a : a;
    }
  }
  return alpha;
}

/** Apply local adjustments. Each mask runs the normal edit maths on a copy and blends it in by its strength. */
export function applyMasks(pixels: Uint8ClampedArray, width: number, height: number, masks: Mask[] | undefined, context: MaskContext): void {
  if (!masks || !hasActiveMasks(masks)) return;
  for (const mask of masks) {
    if (!LOCAL_KEYS.some((key) => mask.edit[key])) continue;
    const alpha = maskAlpha(mask, width, height, context);
    const adjusted = new Uint8ClampedArray(pixels);
    applyPhotoEdit(adjusted, { exposure: 0, warmth: 0, colour: 0, ...mask.edit } as PhotoEdit);
    for (let i = 0; i < alpha.length; i += 1) {
      const a = alpha[i];
      if (a <= 0) continue;
      const j = i * 4;
      pixels[j] += (adjusted[j] - pixels[j]) * a;
      pixels[j + 1] += (adjusted[j + 1] - pixels[j + 1]) * a;
      pixels[j + 2] += (adjusted[j + 2] - pixels[j + 2]) * a;
    }
  }
}
