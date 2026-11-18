import {
  applyDetail,
  applyDetailFloat,
  applyPhotoEdit,
  applyPhotoEditLinearInPlace,
  boxBlurFloat,
  srgbChannelToLinear,
  type PhotoEdit,
} from './photoEdits';
import { LOCAL_KEYS, hasActiveMasks, type Mask } from './maskTypes';

/** Which part of the framed photo a canvas shows. A zoomed region covers a sub-rectangle. */
export interface MaskContext {
  /** The whole photo's long edge in this canvas's pixels, so detail scales match the rest of the edit. Defaults to the canvas. */
  imageEdge?: number;
  /** Height divided by width of the whole framed photo. */
  aspect: number;
  view: { x: number; y: number; w: number; h: number };
  /** Optional normalized luminance guide [0..1] for Guided Filter edge-snapping on subject masks. */
  guide?: Float32Array;
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

function decodeGrid(data: string, count: number): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count && i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Fast O(N) Guided Filter (He, Sun, Tang 2013) using separable box blurs.
 * Snaps coarse segmentation alpha mattes accurately to fine feather/fur edges in the luminance guide.
 */
export function guidedFilterAlpha(
  alpha: Float32Array,
  guide: Float32Array,
  width: number,
  height: number,
  radius: number,
  eps = 0.0025,
): Float32Array<ArrayBuffer> {
  if (width < 4 || height < 4 || radius < 1 || guide.length !== alpha.length) return new Float32Array(alpha);
  const r = Math.min(radius, Math.floor(Math.min(width, height) / 3));
  if (r < 1) return new Float32Array(alpha);
  const count = width * height;
  const meanI = boxBlurFloat(guide, width, height, r);
  const meanP = boxBlurFloat(alpha, width, height, r);
  const corrII = new Float32Array(count);
  const corrIP = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const g = guide[i];
    corrII[i] = g * g;
    corrIP[i] = g * alpha[i];
  }
  const meanII = boxBlurFloat(corrII, width, height, r);
  const meanIP = boxBlurFloat(corrIP, width, height, r);
  const aBuf = new Float32Array(count);
  const bBuf = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const mI = meanI[i];
    const mP = meanP[i];
    const varI = Math.max(0, meanII[i] - mI * mI);
    const covIP = meanIP[i] - mI * mP;
    const a = covIP / (varI + eps);
    aBuf[i] = a;
    bBuf[i] = mP - a * mI;
  }
  const meanA = boxBlurFloat(aBuf, width, height, r);
  const meanB = boxBlurFloat(bBuf, width, height, r);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = Math.min(1, Math.max(0, meanA[i] * guide[i] + meanB[i]));
  }
  return out;
}

/** Fill the brush grid from a detected subject, resampled smoothly to the brush resolution. */
function seedFromSubject(grid: Float32Array, rows: number, subject: Extract<Mask, { kind: 'subject' }>['grid']) {
  const bytes = decodeGrid(subject.data, subject.w * subject.h);
  const at = (x: number, y: number) => bytes[Math.min(subject.h - 1, y) * subject.w + Math.min(subject.w - 1, x)] / 255;
  for (let y = 0; y < rows; y += 1) {
    const fy = Math.min(subject.h - 1.001, Math.max(0, ((y + 0.5) / rows) * subject.h - 0.5));
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < BRUSH_WIDTH; x += 1) {
      const fx = Math.min(subject.w - 1.001, Math.max(0, ((x + 0.5) / BRUSH_WIDTH) * subject.w - 0.5));
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      grid[y * BRUSH_WIDTH + x] = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    }
  }
}

function brushGrid(mask: Extract<Mask, { kind: 'brush' | 'subject' }>, aspect: number) {
  const cached = brushCache.get(mask);
  if (cached && cached.aspect === aspect) return cached;
  const rows = Math.max(1, Math.round(BRUSH_WIDTH * aspect));
  const grid = new Float32Array(BRUSH_WIDTH * rows);
  if (mask.kind === 'subject') seedFromSubject(grid, rows, mask.grid);
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
  let alpha = new Float32Array(width * height);
  const { aspect, view, guide } = context;
  const brush = mask.kind === 'brush' || mask.kind === 'subject' ? brushGrid(mask, aspect) : null;
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
  // Detected subjects are thresholded so the edge follows the subject, and softness sets how gradual that edge is.
  const soften = 0.04 + 0.4 * mask.feather;
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
      } else if (mask.kind === 'subject') {
        a = guide ? sampleBrush(brush!, nx, ny) : smoothstep(0.5 - soften, 0.5 + soften, sampleBrush(brush!, nx, ny));
      } else {
        a = sampleBrush(brush!, nx, ny);
      }
      alpha[y * width + x] = a;
    }
  }
  if (mask.kind === 'subject' && guide && guide.length === alpha.length) {
    const baseRadius = Math.max(3, Math.round(Math.max(width, height) * 0.012));
    const radius = Math.max(2, Math.round(baseRadius * (0.5 + mask.feather)));
    const eps = 0.0005 + mask.feather * 0.004;
    alpha = guidedFilterAlpha(alpha, guide, width, height, radius, eps);
    // Crisp matte contrast curve after guided edge-snapping so interior stays solid and halo falls clean.
    if (mask.feather < 0.7) {
      const lo = 0.25 * (1 - mask.feather);
      const hi = 1 - lo;
      for (let i = 0; i < alpha.length; i += 1) alpha[i] = smoothstep(lo, hi, alpha[i]);
    }
  }
  if (mask.invert) {
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = 1 - alpha[i];
  }
  return alpha;
}

/**
 * A mask's strength once it has been limited by another mask. Only the other mask's own shape is used, never its own
 * limit, so masks cannot loop. A limit that points at a deleted mask is ignored.
 */
export function effectiveAlpha(mask: Mask, masks: readonly Mask[], width: number, height: number, context: MaskContext): Float32Array {
  const alpha = maskAlpha(mask, width, height, context);
  const other = mask.limit ? masks.find((candidate) => candidate.id === mask.limit!.id && candidate.id !== mask.id) : undefined;
  if (!mask.limit || !other) return alpha;
  const limiter = maskAlpha(other, width, height, context);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] *= mask.limit.mode === 'intersect' ? limiter[i] : 1 - limiter[i];
  return alpha;
}

function buildLumaGuideFromBytes(pixels: Uint8ClampedArray, count: number): Float32Array {
  const guide = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const j = i * 4;
    guide[i] = (0.2126 * pixels[j] + 0.7152 * pixels[j + 1] + 0.0722 * pixels[j + 2]) / 255;
  }
  return guide;
}

function buildLumaGuideFromFloat(displayRgba: Float32Array, count: number): Float32Array {
  const guide = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const j = i * 4;
    guide[i] = 0.2126 * displayRgba[j] + 0.7152 * displayRgba[j + 1] + 0.0722 * displayRgba[j + 2];
  }
  return guide;
}

/** Apply local adjustments in continuous Float32 display-referred RGBA [0..1] space without intermediate 8-bit loss. */
export function applyMasksFloat(
  displayRgba: Float32Array,
  width: number,
  height: number,
  masks: Mask[] | undefined,
  context: MaskContext,
): void {
  if (!masks || !hasActiveMasks(masks)) return;
  const needsGuide = masks.some((m) => m.kind === 'subject' || (m.limit && masks.find((c) => c.id === m.limit!.id)?.kind === 'subject'));
  const richContext = !context.guide && needsGuide
    ? { ...context, guide: buildLumaGuideFromFloat(displayRgba, width * height) }
    : context;
  for (const mask of masks) {
    if (!LOCAL_KEYS.some((key) => mask.edit[key])) continue;
    const alpha = effectiveAlpha(mask, masks, width, height, richContext);
    const local = { exposure: 0, warmth: 0, colour: 0, ...mask.edit } as PhotoEdit;
    const adjusted = new Float32Array(displayRgba.length);
    for (let i = 0; i < displayRgba.length; i += 4) {
      adjusted[i] = srgbChannelToLinear(displayRgba[i]);
      adjusted[i + 1] = srgbChannelToLinear(displayRgba[i + 1]);
      adjusted[i + 2] = srgbChannelToLinear(displayRgba[i + 2]);
      adjusted[i + 3] = displayRgba[i + 3];
    }
    applyPhotoEditLinearInPlace(adjusted, local);
    applyDetailFloat(adjusted, width, height, local, richContext.imageEdge ?? Math.max(width, height));
    for (let i = 0; i < alpha.length; i += 1) {
      const a = alpha[i];
      if (a <= 0) continue;
      const j = i * 4;
      displayRgba[j] += (adjusted[j] - displayRgba[j]) * a;
      displayRgba[j + 1] += (adjusted[j + 1] - displayRgba[j + 1]) * a;
      displayRgba[j + 2] += (adjusted[j + 2] - displayRgba[j + 2]) * a;
    }
  }
}

/** Apply local adjustments. Each mask runs the normal edit maths on a copy and blends it in by its strength. */
export function applyMasks(pixels: Uint8ClampedArray, width: number, height: number, masks: Mask[] | undefined, context: MaskContext): void {
  if (!masks || !hasActiveMasks(masks)) return;
  const needsGuide = masks.some((m) => m.kind === 'subject' || (m.limit && masks.find((c) => c.id === m.limit!.id)?.kind === 'subject'));
  const richContext = !context.guide && needsGuide
    ? { ...context, guide: buildLumaGuideFromBytes(pixels, width * height) }
    : context;
  for (const mask of masks) {
    if (!LOCAL_KEYS.some((key) => mask.edit[key])) continue;
    const alpha = effectiveAlpha(mask, masks, width, height, richContext);
    const adjusted = new Uint8ClampedArray(pixels);
    const local = { exposure: 0, warmth: 0, colour: 0, ...mask.edit } as PhotoEdit;
    applyPhotoEdit(adjusted, local);
    applyDetail(adjusted, width, height, local, richContext.imageEdge ?? Math.max(width, height));
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
