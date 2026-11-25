import type { SamMask, SamPrompt, SamTap } from './efficientSam';
import type { SubjectGrid } from './maskTypes';

/**
 * Tap-to-select results as reversible subject masks. EfficientSAM-Ti answers in mask pixels (long edge ≤ 1024);
 * the recipe keeps a compact grid of the framed photo (the validator allows 8 to 512 cells a side), so the selection
 * is box-averaged down: cells on the edge keep the share of the cell that was selected, never a hard stair-step.
 */
export const TAP_GRID_EDGE = 384;
const MIN_CELLS = 8;

export function samMaskToGrid(mask: SamMask, edge = TAP_GRID_EDGE): SubjectGrid {
  const { w, h, data } = mask;
  if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0) || data.length !== w * h) throw new RangeError('The selection has no valid size.');
  const scale = Math.min(1, edge / Math.max(w, h));
  const gw = Math.max(MIN_CELLS, Math.round(w * scale));
  const gh = Math.max(MIN_CELLS, Math.round(h * scale));
  let binary = '';
  for (let gy = 0; gy < gh; gy++) {
    const y0 = (gy * h) / gh;
    const y1 = ((gy + 1) * h) / gh;
    for (let gx = 0; gx < gw; gx++) {
      const x0 = (gx * w) / gw;
      const x1 = ((gx + 1) * w) / gw;
      // Exact area-weighted average of the source pixels this cell covers (works when the grid is larger, too).
      let sum = 0;
      let area = 0;
      for (let y = Math.floor(y0); y < Math.min(h, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.min(w, Math.ceil(x1)); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          sum += data[y * w + x] * wx * wy;
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
