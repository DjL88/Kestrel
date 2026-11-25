import { applyDetail, applyPhotoEdit, blendEncoded8, decodeEncoded, encodeLinear, type PhotoEdit } from './photoEdits';
import { hasActiveMasks, maskIsActive, maskParts, type Mask } from './maskTypes';
import { applyNoiseReduction, hasNoiseReduction } from './noiseReduction';
import { denoiseEyes, denoiseMembers, isDenoisePair, regionNoise } from './denoiseRegions';

/** Which part of the framed photo a canvas shows. A zoomed region covers a sub-rectangle. */
export interface MaskContext {
  /** The whole photo's long edge in this canvas's pixels, so detail scales match the rest of the edit. Defaults to the canvas. */
  imageEdge?: number;
  /** Height divided by width of the whole framed photo. */
  aspect: number;
  view: { x: number; y: number; w: number; h: number };
  /** Where the original photo's centre (the lens's centre) sits on the framed photo, 0..1. Defaults to its middle. */
  lensCentre?: { x: number; y: number };
}

export const fullContext = (width: number, height: number): MaskContext => ({
  aspect: height / width, view: { x: 0, y: 0, w: 1, h: 1 },
});

const smoothstep = (low: number, high: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low || 1e-6)));
  return t * t * (3 - 2 * t);
};

const BRUSH_WIDTH = 384;
type BrushGrid = { aspect: number; cols: number; rows: number; scale: Float32Array; floor: Float32Array };
const brushCache = new WeakMap<Mask, BrushGrid>();
const subjectCache = new WeakMap<object, Uint8Array>();
const detailCache = new WeakMap<object, Float32Array>();

/** The subject's fine outline, decoded once per mask. */
function detailValues(detail: NonNullable<Extract<Mask, { kind: 'subject' }>['detail']>): Float32Array {
  let values = detailCache.get(detail);
  if (!values) {
    const bytes = decodeGrid(detail.grid.data, detail.grid.w * detail.grid.h);
    values = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) values[i] = bytes[i] / 255;
    detailCache.set(detail, values);
  }
  return values;
}

/** The fine outline at a point of the framed photo, or null outside its region. Bilinear between cells. */
function sampleDetail(detail: NonNullable<Extract<Mask, { kind: 'subject' }>['detail']>, nx: number, ny: number): number | null {
  const { region, grid } = detail;
  const lx = (nx - region.x) / region.w;
  const ly = (ny - region.y) / region.h;
  if (lx < 0 || lx > 1 || ly < 0 || ly > 1) return null;
  const values = detailValues(detail);
  const fx = Math.min(grid.w - 1.001, Math.max(0, lx * grid.w - 0.5));
  const fy = Math.min(grid.h - 1.001, Math.max(0, ly * grid.h - 0.5));
  const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
  const at = (xx: number, yy: number) => values[yy * grid.w + xx];
  return (at(x, y) * (1 - tx) + at(x + 1, y) * tx) * (1 - ty) + (at(x, y + 1) * (1 - tx) + at(x + 1, y + 1) * tx) * ty;
}

function decodeGrid(data: string, count: number): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(count);
  for (let i = 0; i < count && i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Sample the original detection directly: avoid resampling fine edges through a brush raster. */
function sampleSubject(subject: Extract<Mask, { kind: 'subject' }>['grid'], nx: number, ny: number): number {
  let bytes = subjectCache.get(subject);
  if (!bytes) {
    bytes = decodeGrid(subject.data, subject.w * subject.h);
    subjectCache.set(subject, bytes);
  }
  return sampleRaster(bytes, subject.w, subject.h, nx, ny) / 255;
}

function sampleRaster(values: ArrayLike<number>, cols: number, rows: number, nx: number, ny: number): number {
  const fx = Math.max(0, Math.min(cols - 1, nx * cols - 0.5));
  const fy = Math.max(0, Math.min(rows - 1, ny * rows - 0.5));
  const x = Math.floor(fx), y = Math.floor(fy);
  const tx = fx - x, ty = fy - y;
  const right = Math.min(cols - 1, x + 1), bottom = Math.min(rows - 1, y + 1);
  return (values[y * cols + x] * (1 - tx) + values[y * cols + right] * tx) * (1 - ty)
    + (values[bottom * cols + x] * (1 - tx) + values[bottom * cols + right] * tx) * ty;
}

/**
 * Paint and erase compose into max(original * scale, floor). Store those two
 * coefficients, not a painted copy of the coarse detection. This lets the
 * photographer refine the actual fine outline even when it disagrees with the
 * coarse grid, and keeps partial brush edges from introducing coarse pixels.
 */
function brushGrid(mask: Extract<Mask, { kind: 'brush' | 'subject' }>, aspect: number): BrushGrid {
  const cached = brushCache.get(mask);
  if (cached && cached.aspect === aspect) return cached;
  // Bound the long edge even for exceptionally tall or wide crops.
  const cols = Math.max(1, Math.round(BRUSH_WIDTH / Math.max(1, aspect)));
  const rows = Math.max(1, Math.round(BRUSH_WIDTH * Math.min(1, aspect)));
  const scale = new Float32Array(cols * rows).fill(1);
  const floor = new Float32Array(cols * rows);
  const dab = (cx: number, cy: number, radius: number, erase: boolean) => {
    // On an extreme crop a dab can be thinner than one grid cell; never let it
    // fall between cell centres and silently vanish.
    const rx = Math.max(1, radius * cols);
    const ry = Math.max(1, radius * rows / aspect);
    const x0 = Math.max(0, Math.floor(cx * cols - rx));
    const x1 = Math.min(cols - 1, Math.ceil(cx * cols + rx));
    const y0 = Math.max(0, Math.floor(cy * rows - ry));
    const y1 = Math.min(rows - 1, Math.ceil(cy * rows + ry));
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const d = Math.hypot((x + 0.5 - cx * cols) / rx, (y + 0.5 - cy * rows) / ry);
      if (d >= 1) continue;
      const strength = 1 - smoothstep(0.45, 1, d);
      const index = y * cols + x;
      if (erase) {
        scale[index] *= 1 - strength;
        floor[index] *= 1 - strength;
      } else {
        floor[index] = Math.max(floor[index], strength);
      }
    }
  };
  for (const stroke of mask.strokes) {
    const { points, radius, erase } = stroke;
    if (points.length < 2) continue;
    dab(points[0], points[1], radius, erase);
    const spacing = Math.max(radius * 0.3, 0.002, Math.max(1, aspect) / (BRUSH_WIDTH * 4));
    for (let i = 2; i < points.length; i += 2) {
      const dx = points[i] - points[i - 2];
      const dy = (points[i + 1] - points[i - 1]) * aspect;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / spacing));
      for (let j = 1; j <= steps; j += 1) {
        const t = j / steps;
        dab(points[i - 2] + dx * t, points[i - 1] + (points[i + 1] - points[i - 1]) * t, radius, erase);
      }
    }
  }
  const made = { aspect, cols, rows, scale, floor };
  brushCache.set(mask, made);
  return made;
}

function refineBrush(made: BrushGrid | null, base: number, nx: number, ny: number): number {
  if (!made) return base;
  const scale = sampleRaster(made.scale, made.cols, made.rows, nx, ny);
  const floor = sampleRaster(made.floor, made.cols, made.rows, nx, ny);
  return Math.max(base * scale, floor);
}

function invalidGradient(mask: Mask): boolean {
  return mask.kind === 'linear' && (![mask.x1, mask.y1, mask.x2, mask.y2].every(Number.isFinite) || (mask.x1 === mask.x2 && mask.y1 === mask.y2));
}

/** Mask strength, 0 to 1, for every pixel of a canvas that shows `context.view`. */
export function maskAlpha(mask: Mask, width: number, height: number, context: MaskContext): Float32Array {
  const alpha = new Float32Array(width * height);
  // A collapsed gradient has no direction: never apply it to the entire image.
  if (invalidGradient(mask)) return alpha;
  const { aspect, view } = context;
  const brush = (mask.kind === 'brush' || mask.kind === 'subject') && mask.strokes.length ? brushGrid(mask, aspect) : null;
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
        // Rotate the offset back into the oval's local axes. Both axes
        // use photo-width units so orientation remains stable at every crop/zoom.
        const rad = ((mask.angle ?? 0) * Math.PI) / 180;
        const cosine = Math.cos(rad);
        const sine = Math.sin(rad);
        const offsetX = nx - mask.cx;
        const offsetY = (ny - mask.cy) * aspect;
        const localX = offsetX * cosine + offsetY * sine;
        const localY = -offsetX * sine + offsetY * cosine;
        const d = Math.hypot(localX / mask.rx, localY / mask.ry);
        a = 1 - smoothstep(inner, 1, d);
      } else if (mask.kind === 'subject') {
        const fine = mask.detail ? sampleDetail(mask.detail, nx, ny) : null;
        const value = refineBrush(brush, fine ?? sampleSubject(mask.grid, nx, ny), nx, ny);
        a = smoothstep(0.5 - soften, 0.5 + soften, value);
      } else {
        a = refineBrush(brush, 0, nx, ny);
      }
      alpha[y * width + x] = mask.invert ? 1 - a : a;
    }
  }
  return alpha;
}

/**
 * A mask's strength once it has been limited by another mask. Only the other mask's own shape is used, never its own
 * limit, so masks cannot loop. A missing or ambiguous limiter disables the affected alpha.
 */
export function effectiveAlpha(mask: Mask, masks: readonly Mask[], width: number, height: number, context: MaskContext): Float32Array {
  const alpha = maskAlpha(mask, width, height, context);
  // Parts apply in order: add takes the larger strength (union), subtract removes the other area, intersect keeps the overlap.
  for (const part of maskParts(mask)) {
    const candidates = masks.filter(candidate => candidate.id === part.id && candidate.id !== mask.id);
    // A broken part must never broaden a previously local edit.
    if (candidates.length !== 1 || !['add', 'subtract', 'intersect'].includes(part.mode)) return alpha.fill(0);
    if (invalidGradient(candidates[0])) return alpha.fill(0);
    const other = maskAlpha(candidates[0], width, height, context);
    for (let i = 0; i < alpha.length; i += 1) {
      alpha[i] = part.mode === 'add' ? Math.max(alpha[i], other[i]) : part.mode === 'intersect' ? alpha[i] * other[i] : alpha[i] * (1 - other[i]);
    }
  }
  return alpha;
}

/** Apply local adjustments. Each mask runs the normal edit maths on a copy and blends it in by its strength. */
export function applyMasks(pixels: Uint8ClampedArray, width: number, height: number, masks: Mask[] | undefined, context: MaskContext): void {
  if (!masks || !hasActiveMasks(masks)) return;
  const overrides = new Map<string, { members: Mask[]; eyes: Mask[] }>();
  const consumed = new Set<string>();
  for (let i = 0; i + 1 < masks.length; i++) {
    const group = masks[i + 1];
    if (!isDenoisePair(masks[i], group)) continue;
    const members = denoiseMembers(group, masks);
    const eyes = denoiseEyes(group, masks);
    overrides.set(group.id, { members, eyes });
    members.forEach(m => consumed.add(m.id));
    eyes.forEach(m => consumed.add(m.id));
  }
  for (let index = 0; index < masks.length; index += 1) {
    const mask = masks[index];
    const subject = masks[index + 1];
    if (isDenoisePair(mask, subject)) {
      const alpha = maskAlpha(subject, width, height, context);
      // Every region is filtered from this same source, never from another filter's output.
      const filter = (region: Mask) => applyNoiseReduction(pixels, width, height,
        { exposure: 0, warmth: 0, colour: 0, ...regionNoise(region) } as PhotoEdit);
      const backgroundPixels = filter(mask);
      const subjectPixels = filter(subject);
      const { members, eyes } = overrides.get(subject.id) ?? { members: [], eyes: [] };
      const count = width * height;
      if (members.length || eyes.length) {
        const linear = Array.from({ length: 256 }, (_, v) => decodeEncoded(v / 255));
        // For individual overrides, normalise overlapping coverage rather than filtering the output of another filter.
        const total = new Float32Array(count);
        const coverage = new Float32Array(count);
        const rgb = new Float32Array(count * 3);
        for (const member of members) {
          const a = effectiveAlpha(member, masks, width, height, context);
          const candidate = filter(member);
          for (let i = 0; i < count; i++) {
            const weight = a[i] * alpha[i];
            total[i] += weight;
            coverage[i] = Math.max(coverage[i], weight);
            for (let c = 0; c < 3; c++) rgb[i * 3 + c] += linear[candidate[i * 4 + c]] * weight;
          }
        }
        // Eyes take priority over every subject strength: the gentlest region wins where an eye covers the subject.
        const eyeCover = new Float32Array(eyes.length ? count : 0);
        const eyeRgb = new Float32Array(eyes.length ? count * 3 : 0);
        for (const eye of eyes) {
          const a = effectiveAlpha(eye, masks, width, height, context);
          const candidate = filter(eye);
          for (let i = 0; i < count; i++) {
            const weight = a[i] * alpha[i];
            if (weight <= eyeCover[i]) continue;
            eyeCover[i] = weight;
            for (let c = 0; c < 3; c++) eyeRgb[i * 3 + c] = linear[candidate[i * 4 + c]];
          }
        }
        for (let i = 0; i < count; i++) {
          for (let c = 0; c < 3; c++) {
            const j = i * 4 + c;
            const base = linear[backgroundPixels[j]] * (1 - alpha[i]) + linear[subjectPixels[j]] * alpha[i];
            // Overrides replace only the subject contribution, leaving the complementary background contribution intact.
            let value = total[i] > 0 ? base + coverage[i] * (rgb[i * 3 + c] / total[i] - linear[subjectPixels[j]]) : base;
            if (eyes.length && eyeCover[i] > 0) value += eyeCover[i] * (eyeRgb[i * 3 + c] - value);
            pixels[j] = Math.round(encodeLinear(Math.max(0, Math.min(1, value))) * 255);
          }
        }
      } else {
        for (let i = 0; i < count; i++) {
          const j = i * 4;
          for (let c = 0; c < 3; c++) pixels[j + c] = blendEncoded8(backgroundPixels[j + c], subjectPixels[j + c], alpha[i]);
        }
      }
      index += 1;
      continue;
    }
    if (!maskIsActive(mask)) continue;
    const alpha = effectiveAlpha(mask, masks, width, height, context);
    const local = { exposure: 0, warmth: 0, colour: 0, ...mask.edit } as PhotoEdit;
    if (consumed.has(mask.id)) { delete local.denoise; delete local.denoiseLuminance; }
    const adjusted = hasNoiseReduction(local) ? applyNoiseReduction(pixels, width, height, local) : new Uint8ClampedArray(pixels);
    applyPhotoEdit(adjusted, local);
    applyDetail(adjusted, width, height, local, context.imageEdge ?? Math.max(width, height));
    for (let i = 0; i < alpha.length; i += 1) {
      const a = alpha[i];
      if (a <= 0) continue;
      const j = i * 4;
      // Linear-light mix, same convention as the 16-bit master (no dark fringe at feathered edges).
      pixels[j] = blendEncoded8(pixels[j], adjusted[j], a);
      pixels[j + 1] = blendEncoded8(pixels[j + 1], adjusted[j + 1], a);
      pixels[j + 2] = blendEncoded8(pixels[j + 2], adjusted[j + 2], a);
    }
  }
}
