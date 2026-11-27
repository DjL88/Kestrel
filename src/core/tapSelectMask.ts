import type { SamMask, SamPrompt, SamTap } from './efficientSam';
import type { SubjectDetail, SubjectGrid } from './maskTypes';
import { detailSizeFor } from './subjectModel';

/**
 * Tap-to-select results as reversible subject masks. EfficientSAM-Ti answers in mask pixels (long edge ≤ 1024);
 * the recipe keeps a compact grid of the framed photo (the validator allows 8 to 512 cells a side), so the selection
 * is box-averaged down: cells on the edge keep the share of the cell that was selected, never a hard stair-step.
 */
export const TAP_GRID_EDGE = 384;
const MIN_CELLS = 8;

export function samMaskToGrid(mask: SamMask, edge = TAP_GRID_EDGE): SubjectGrid {
  const { w, h } = checked(mask);
  const scale = Math.min(1, edge / Math.max(w, h));
  const gw = Math.max(MIN_CELLS, Math.round(w * scale));
  const gh = Math.max(MIN_CELLS, Math.round(h * scale));
  return areaGrid(mask, { x: 0, y: 0, w, h }, gw, gh);
}

/** Pixels of the mask that count as the subject's edge or inside it, for the fine outline's region. */
const SOFT_FLOOR = 8;
/** Room round the subject in its fine outline, as a share of the subject's size (a feathered edge stays inside). */
const DETAIL_PADDING = 0.06;

/**
 * The subject's fine outline: the model's soft mask over the subject's own rectangle (with a little room), at up to
 * DETAIL_EDGE cells a side, so the edge is drawn from the mask's own resolution rather than the whole-frame grid. Null
 * when there is nothing selected or the subject fills most of the frame (the whole-frame grid is then just as fine).
 */
export function samMaskDetail(mask: SamMask): SubjectDetail | null {
  const { w, h, data } = checked(mask);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (data[i] || (mask.soft && mask.soft[i] >= SOFT_FLOOR)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const padX = Math.ceil((x1 - x0 + 1) * DETAIL_PADDING) + 2, padY = Math.ceil((y1 - y0 + 1) * DETAIL_PADDING) + 2;
  const rx = Math.max(0, x0 - padX), ry = Math.max(0, y0 - padY);
  const rw = Math.min(w, x1 + 1 + padX) - rx, rh = Math.min(h, y1 + 1 + padY) - ry;
  if (rw * rh > 0.8 * w * h) return null;
  const size = detailSizeFor(rw, rh);
  return { region: { x: rx / w, y: ry / h, w: rw / w, h: rh / h }, grid: areaGrid(mask, { x: rx, y: ry, w: rw, h: rh }, size.w, size.h) };
}

function checked(mask: SamMask): SamMask {
  const { w, h, data } = mask;
  if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0) || data.length !== w * h) throw new RangeError('The selection has no valid size.');
  if (mask.soft && mask.soft.length !== w * h) throw new RangeError('The selection has no valid size.');
  return mask;
}

/** Exact area-weighted average of the mask over a rectangle of its pixels, as gw x gh cells (the soft edge when known). */
function areaGrid(mask: SamMask, rect: { x: number; y: number; w: number; h: number }, gw: number, gh: number): SubjectGrid {
  const { w, data, soft } = mask;
  const value = soft ? (i: number) => soft[i] / 255 : (i: number) => data[i];
  let binary = '';
  for (let gy = 0; gy < gh; gy++) {
    const y0 = rect.y + (gy * rect.h) / gh;
    const y1 = rect.y + ((gy + 1) * rect.h) / gh;
    for (let gx = 0; gx < gw; gx++) {
      const x0 = rect.x + (gx * rect.w) / gw;
      const x1 = rect.x + ((gx + 1) * rect.w) / gw;
      // Works when the grid is larger, too: each cell takes the share of every pixel it covers.
      let sum = 0;
      let area = 0;
      for (let y = Math.floor(y0); y < Math.min(rect.y + rect.h, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.min(rect.x + rect.w, Math.ceil(x1)); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          sum += value(y * w + x) * wx * wy;
          area += wx * wy;
        }
      }
      binary += String.fromCharCode(Math.round((area > 0 ? sum / area : 0) * 255));
    }
  }
  return { w: gw, h: gh, data: btoa(binary) };
}

/** The model's own predicted quality (not a measured accuracy), in the recipe's words. High only when it is very sure. */
export function samConfidence(score: number): 'high' | 'medium' | 'low' {
  if (!Number.isFinite(score)) return 'low';
  return score >= 0.9 ? 'high' : score >= 0.75 ? 'medium' : 'low';
}

/** A tap kept as shares (0 to 1) of the framed photo, so it survives any display size. */
export interface PhotoTap { x: number; y: number; add: boolean }

export function tapInMask(tap: PhotoTap, size: { w: number; h: number }): SamTap {
  const clamp = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
  return { x: clamp(tap.x) * size.w, y: clamp(tap.y) * size.h, add: tap.add };
}

export function tapSelectPrompt(taps: readonly PhotoTap[], size: { w: number; h: number }): SamPrompt {
  return { taps: taps.map(tap => tapInMask(tap, size)) };
}
