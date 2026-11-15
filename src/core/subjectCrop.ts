import type { SubjectGrid } from './maskTypes';

export interface SquareCrop { x: number; y: number; size: number }

/** How far past the animal to look, as a share of its own size, so the edges and surroundings stay in view. */
const MARGIN = 0.18;
/** The crop is never smaller than this share of the picture's short side. A tiny speck is not worth zooming in on. */
const MIN_SHARE = 0.4;
/** Less of the picture than this counts as noise, not a subject. */
const MIN_COVERAGE = 0.01;

function cells(grid: SubjectGrid): Uint8Array {
  const binary = atob(grid.data);
  const out = new Uint8Array(grid.w * grid.h);
  for (let i = 0; i < out.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** The box around everything the mask marks as subject, as fractions of the picture (0 to 1), or null when there is none. */
export function subjectBox(grid: SubjectGrid, threshold = 128): { x0: number; y0: number; x1: number; y1: number } | null {
  const values = cells(grid);
  let x0 = grid.w, y0 = grid.h, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < grid.h; y += 1) {
    for (let x = 0; x < grid.w; x += 1) {
      if (values[y * grid.w + x] < threshold) continue;
      count += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (count / (grid.w * grid.h) < MIN_COVERAGE) return null;
  return { x0: x0 / grid.w, y0: y0 / grid.h, x1: (x1 + 1) / grid.w, y1: (y1 + 1) / grid.h };
}

/**
 * The square of the picture to show the species model: centred on the subject, with a margin, never smaller than a
 * share of the picture and never outside it. With no usable subject it falls back to the centre square, which is what
 * the model was trained on.
 */
export function subjectCrop(width: number, height: number, grid: SubjectGrid | null | undefined): SquareCrop {
  const short = Math.min(width, height);
  const centre = { x: Math.round((width - short) / 2), y: Math.round((height - short) / 2), size: short };
  const box = grid ? subjectBox(grid) : null;
  if (!box) return centre;
  const boxWidth = (box.x1 - box.x0) * width, boxHeight = (box.y1 - box.y0) * height;
  const wanted = Math.max(boxWidth, boxHeight) * (1 + MARGIN * 2);
  const size = Math.round(Math.min(short, Math.max(short * MIN_SHARE, wanted)));
  const cx = ((box.x0 + box.x1) / 2) * width, cy = ((box.y0 + box.y1) / 2) * height;
  const clamp = (value: number, max: number) => Math.round(Math.max(0, Math.min(max, value)));
  return { x: clamp(cx - size / 2, width - size), y: clamp(cy - size / 2, height - size), size };
}
