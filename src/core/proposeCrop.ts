/**
 * A suggested crop, never an automatic one. Pure: it takes the subject's box (from `subjectBox`), the picture's size and
 * the shape of the frame, and returns a rectangle of the picture, or null when there is nothing worth suggesting.
 *
 * Rules, in order: the subject is never cut (it keeps a margin inside the crop); the picture is never enlarged by more
 * than MAX_ENLARGEMENT so resolution is not lost quietly; the subject sits near a rule-of-thirds point, with room left in
 * the direction it faces when that is known; and a picture that is already well framed, or a subject that is unknown,
 * gives null ("unknown stays unknown").
 */

export interface SubjectFractions { x0: number; y0: number; x1: number; y1: number }
export type Facing = 'left' | 'right';

/** A crop rectangle as fractions of the picture (0 to 1), with how much it enlarges the picture (1 means not at all). */
export interface CropProposal extends SubjectFractions { enlargement: number }

/** The most the suggestion may enlarge the picture, linearly. 1.5 keeps at least 44% of the pixels. */
export const MAX_ENLARGEMENT = 1.5;
/** The subject fills about this much of the crop's tighter dimension. */
const SUBJECT_SHARE = 0.6;
/** Space kept round the subject inside the crop, as a share of the crop. The subject is never cut. */
const SAFE_MARGIN = 0.04;
/** A suggestion that keeps this much of the largest possible crop is not worth making. */
const NOT_WORTH_IT = 0.93;
/** The subject must be small enough to sit inside the frame with its margin. */
const MIN_BOX = 0.02;

/** The subject's centre must sit at least this far in from every edge of the suggested crop (a third is 0.33). */
export const EDGE_ZONE = 0.22;

const finite = (value: number) => Number.isFinite(value);

export function proposeCrop(input: {
  box: SubjectFractions | null | undefined;
  imageWidth: number;
  imageHeight: number;
  /** Frame width over height. Defaults to the picture's own shape (the Original). */
  aspect?: number;
  /** Which way the subject faces, when known. Unknown leaves the lead room to the nearest third. */
  facing?: Facing;
}): CropProposal | null {
  const { box, imageWidth: W, imageHeight: H } = input;
  if (!box || !finite(W) || !finite(H) || W <= 0 || H <= 0) return null;
  const { x0, y0, x1, y1 } = box;
  if (![x0, y0, x1, y1].every(finite) || x1 - x0 < MIN_BOX * 0.25 || y1 - y0 < MIN_BOX * 0.25) return null;
  if (x0 < 0 || y0 < 0 || x1 > 1 || y1 > 1 || x1 <= x0 || y1 <= y0) return null;
  const aspect = input.aspect !== undefined && finite(input.aspect) && input.aspect > 0 ? input.aspect : W / H;

  // The largest crop of this shape that fits the picture.
  const maxW = W / H > aspect ? H * aspect : W;
  const maxH = maxW / aspect;
  const subjectW = (x1 - x0) * W, subjectH = (y1 - y0) * H;

  // Size: the subject fills about SUBJECT_SHARE of the tighter axis, never less margin than SAFE_MARGIN, never an
  // enlargement past the limit, never bigger than the picture.
  const wanted = Math.max(subjectW / SUBJECT_SHARE, (subjectH * aspect) / SUBJECT_SHARE);
  const needed = Math.max(subjectW, subjectH * aspect) / (1 - 2 * SAFE_MARGIN);
  const width = Math.min(maxW, Math.max(wanted, maxW / MAX_ENLARGEMENT));
  if (needed > width + 1e-6) return null; // the subject cannot sit inside this frame with its margin
  const height = width / aspect;

  // Place the subject on a thirds point. Facing right puts it on the left third so there is room ahead, and the reverse.
  const cx = ((x0 + x1) / 2) * W, cy = ((y0 + y1) / 2) * H;
  const alongX = (cx - 0) / W; // 0..1 across the picture
  const thirdX = input.facing === 'right' ? 1 / 3 : input.facing === 'left' ? 2 / 3
    : Math.abs(alongX - 1 / 3) <= Math.abs(alongX - 2 / 3) ? 1 / 3 : 2 / 3;
  const thirdY = (cy / H) < 0.5 ? 1 / 3 : 2 / 3;
  let left = cx - thirdX * width;
  let top = cy - thirdY * height;
  left = Math.min(W - width, Math.max(0, left));
  top = Math.min(H - height, Math.max(0, top));
  // Keep the whole subject, with its margin, inside; moving the window is allowed, cutting the subject is not.
  const marginX = width * SAFE_MARGIN, marginY = height * SAFE_MARGIN;
  left = Math.min(x0 * W - marginX, Math.max(x1 * W + marginX - width, left));
  top = Math.min(y0 * H - marginY, Math.max(y1 * H + marginY - height, top));
  left = Math.min(W - width, Math.max(0, left));
  top = Math.min(H - height, Math.max(0, top));
  if (left > x0 * W + 1e-6 || left + width < x1 * W - 1e-6 || top > y0 * H + 1e-6 || top + height < y1 * H - 1e-6) return null;

  // Never jam the subject into an edge or corner of the suggested frame: if the picture's own edges forced it there, suggest nothing.
  const relX = (cx - left) / width, relY = (cy - top) / height;
  if (relX < EDGE_ZONE || relX > 1 - EDGE_ZONE || relY < EDGE_ZONE || relY > 1 - EDGE_ZONE) return null;

  if (width / maxW >= NOT_WORTH_IT) return null; // nearly the whole picture: already well framed
  return { x0: left / W, y0: top / H, x1: (left + width) / W, y1: (top + height) / H, enlargement: maxW / width };
}
