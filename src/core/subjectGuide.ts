import type { Region } from './subjectRegion';

/**
 * Detector-guided subject masks.
 *
 * The salient-object model (U²-Net-P) sees the whole photo squashed to 320 × 320, so a distant bird is a few cells
 * wide and its mask is a blur. The subject detector (YOLOX, searched in tiles) finds small subjects well but only
 * gives a box. Together: find the box, cut out the area around it at the photo's own detail, find the subject's
 * outline there, and lay the result back on a grid fine enough to keep that outline.
 */

/** A detector box in pixels of the framed photo it was found on. */
export interface PixelBox { x: number; y: number; w: number; h: number }

/** Below this detector score the box is too doubtful to steer the mask; the whole-photo search is used instead. */
export const GUIDE_MIN_SCORE = 0.35;
/** A subject this big already fills the model's view, so cutting around it gains nothing. */
export const GUIDE_MAX_COVERAGE = 0.5;
/** Room left around the box on each side, as a share of the box, so wing tips and tails outside it are kept. */
export const GUIDE_MARGIN = 0.35;
/** The cut-out is never narrower than this share of the photo, so the model still sees some background to separate. */
export const GUIDE_MIN_SIDE = 0.12;

/**
 * The area to look for the subject's outline in, as fractions of the framed photo, or null when the detection should
 * not steer the mask (no box, doubtful score, damaged numbers, or a subject that already fills the photo).
 */
export function guideRegion(box: PixelBox | null | undefined, score: number, width: number, height: number): Region | null {
  if (!box || !(width > 0) || !(height > 0)) return null;
  if (!Number.isFinite(score) || score < GUIDE_MIN_SCORE || score > 1) return null;
  if (![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w <= 0 || box.h <= 0) return null;
  const x0 = Math.max(0, box.x), y0 = Math.max(0, box.y);
  const x1 = Math.min(width, box.x + box.w), y1 = Math.min(height, box.y + box.h);
  if (x1 <= x0 || y1 <= y0) return null;
  if (((x1 - x0) * (y1 - y0)) / (width * height) > GUIDE_MAX_COVERAGE) return null;

  const grow = (start: number, end: number, size: number) => {
    const length = end - start;
    const wanted = Math.max(length * (1 + 2 * GUIDE_MARGIN), GUIDE_MIN_SIDE * size);
    const centre = (start + end) / 2;
    // Slide the window back inside the photo instead of shrinking it at an edge.
    const from = Math.min(Math.max(0, centre - wanted / 2), Math.max(0, size - wanted));
    return { from: from / size, span: Math.min(size, wanted) / size };
  };
  const horizontal = grow(x0, x1, width);
  const vertical = grow(y0, y1, height);
  return { x: horizontal.from, y: vertical.from, w: horizontal.span, h: vertical.span };
}

/** Longest side of the whole-photo grid a guided mask is laid on. The validator allows 512; this keeps recipes small. */
export const GUIDED_GRID_MAX = 384;
/** The ordinary whole-photo grid's longest side (see gridSizeFor in subjectModel.ts). */
export const GUIDED_GRID_MIN = 192;

/**
 * A whole-photo grid fine enough that the cut-out area keeps about as many cells across as the model produced for it,
 * capped so a recipe stays small. `aspect` is height / width of the framed photo.
 */
export function guidedGridSize(aspect: number, region: Region): { w: number; h: number } {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const largestShare = Math.max(region.w, region.h, 1e-3);
  const long = Math.round(Math.min(GUIDED_GRID_MAX, Math.max(GUIDED_GRID_MIN, GUIDED_GRID_MIN / largestShare)));
  return safeAspect >= 1
    ? { w: Math.max(8, Math.round(long / safeAspect)), h: long }
    : { w: long, h: Math.max(8, Math.round(long * safeAspect)) };
}

/**
 * Longest side to draw the framed photo at for guided detection: enough detail for the cut-out to be sharper than the
 * whole-photo view, without asking the browser for an enormous canvas.
 */
export const GUIDED_RENDER_EDGE = 2400;
