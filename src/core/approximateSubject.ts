import { encodeValues, gridSizeFor } from './subjectModel';
import type { SubjectGrid } from './maskTypes';
import type { Box } from './objectDetection';

/**
 * An APPROXIMATE subject area for when the outline model is not available (switched off, not installed, or failed).
 * It is built only from the box the allowed object detector found: a soft ellipse inscribed in that box, eased down
 * wherever the picture inside the box has little fine detail (an out-of-focus corner of the box is not the subject).
 * It is never an outline of the subject, so it is always labelled approximate and never given high confidence.
 * Pure: nothing here edits a photo.
 */

/** How the person is told, wherever the area is offered. */
export const APPROXIMATE_SUBJECT_LABEL = 'Approximate subject area, from the detector';

/** Ellipse coverage 0 to 1 at a point (fractions of the box), soft over the outer 30% of the radius. */
export function ellipseWeight(u: number, v: number): number {
  const r = Math.hypot((u - 0.5) * 2, (v - 0.5) * 2);
  if (r <= 0.7) return 1;
  if (r >= 1) return 0;
  const t = (1 - r) / 0.3;
  return t * t * (3 - 2 * t);
}

/** Local detail (gradient energy) per grid cell inside the box, as 0.5 to 1: the sharpest tenth of cells count fully. */
function detailFactors(rgba: Uint8ClampedArray, width: number, height: number, box: Box, w: number, h: number): Float32Array {
  const energy = new Float32Array(w * h);
  const luma = (x: number, y: number) => { const i = (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4; return 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]; };
  const inside: number[] = [];
  for (let gy = 0; gy < h; gy += 1) for (let gx = 0; gx < w; gx += 1) {
    const cx = (gx + 0.5) / w, cy = (gy + 0.5) / h;
    if (cx < box.x || cx > box.x + box.w || cy < box.y || cy > box.y + box.h) continue;
    const x = Math.round(cx * width), y = Math.round(cy * height);
    const e = Math.abs(luma(x + 1, y) - luma(x - 1, y)) + Math.abs(luma(x, y + 1) - luma(x, y - 1));
    energy[gy * w + gx] = e;
    inside.push(e);
  }
  const factors = new Float32Array(w * h).fill(1);
  if (inside.length < 16) return factors;
  inside.sort((a, b) => a - b);
  const reference = inside[Math.floor(inside.length * 0.9)];
  if (reference < 4) return factors; // a flat box: nothing to tell sharp from soft, so no tapering
  for (let i = 0; i < factors.length; i += 1) factors[i] = Math.min(1, 0.5 + 0.5 * Math.min(1, energy[i] / reference));
  return factors;
}

/**
 * The grid for a detector box given as fractions of the framed photo (0 to 1). `pixels`, when given, are the framed
 * photo's RGBA at any size; they only taper the area where the box has no fine detail.
 */
export function approximateSubjectGrid(box: Box, aspect: number, pixels?: { data: Uint8ClampedArray; width: number; height: number }): SubjectGrid {
  const { w, h } = gridSizeFor(aspect);
  const factors = pixels && pixels.data.length === pixels.width * pixels.height * 4 ? detailFactors(pixels.data, pixels.width, pixels.height, box, w, h) : null;
  const values = new Float32Array(w * h);
  for (let gy = 0; gy < h; gy += 1) for (let gx = 0; gx < w; gx += 1) {
    const u = ((gx + 0.5) / w - box.x) / box.w, v = ((gy + 0.5) / h - box.y) / box.h;
    if (u < 0 || u > 1 || v < 0 || v > 1) continue;
    values[gy * w + gx] = ellipseWeight(u, v) * (factors ? factors[gy * w + gx] : 1);
  }
  return encodeValues(values, w, h);
}

/** Share of the frame the box covers; a box that is most of the frame is not a subject area worth offering. */
export const boxCoverage = (box: Box): number => Math.max(0, box.w) * Math.max(0, box.h);

/** A detector box in pixels of the framed photo, as fractions of it (0 to 1), kept inside the frame. */
export function boxToFractions(box: Box, width: number, height: number): Box | null {
  if (!(width > 0 && height > 0)) return null;
  const x = Math.max(0, box.x / width), y = Math.max(0, box.y / height);
  const w = Math.min(1 - x, box.w / width), h = Math.min(1 - y, box.h / height);
  return w > 0.01 && h > 0.01 ? { x, y, w, h } : null;
}
