import { previewKey, previewOn } from './previewFeatures';

/**
 * Subject sharpness measured inside the subject's own mask instead of its detector box (x-std-mask-sharpness).
 *
 * The box method (objectDetection.ts boxSharpness) averages the Laplacian over everything in the padded box, so a
 * sharp branch or reed behind a soft bird lifts the score, and flat sky beside a sharp bird drags it down. Here the
 * same Laplacian, on the same 160 px crop, is averaged only over pixels the mask says are the subject. The mask comes
 * from EfficientSAM-Ti prompted with the detector's box. Without a usable mask the caller keeps the box value, so
 * this can only ever replace a measurement, never remove one.
 *
 * Idea from Project Kestrel (AGPLv3); no code was copied.
 */

export interface SubjectMaskPixels {
  w: number;
  h: number;
  /** 1 inside the subject, 0 outside, row by row. */
  data: Uint8Array;
  /** The model's own estimate of mask quality, 0..1. Not a measured accuracy. */
  score: number;
}

export interface Region { x: number; y: number; w: number; h: number }

/** Fewer subject pixels than this in the crop, and the mask is not trusted to say anything about sharpness. */
export const MIN_MASK_PIXELS = 64;
/** A mask the model itself rates below this is not used. */
export const MIN_MASK_SCORE = 0.5;
/** A "subject" covering nearly the whole frame is a failed mask, not a subject. */
export const MAX_MASK_COVERAGE = 0.9;

/** Device preview switch (Settings → Preview features) that turns masked sharpness on. */
export const CULL_MASK_SHARPNESS_KEY = previewKey('cullMaskSharpness');

export function cullMaskSharpnessOn(storage: Pick<Storage, 'getItem'> | null | undefined =
  typeof localStorage === 'undefined' ? null : localStorage): boolean {
  return previewOn('cullMaskSharpness', storage);
}

/** Is this mask fit to measure with? */
export function usableMask(mask: SubjectMaskPixels | null | undefined): mask is SubjectMaskPixels {
  if (!mask || !Number.isSafeInteger(mask.w) || !Number.isSafeInteger(mask.h) || mask.w <= 0 || mask.h <= 0) return false;
  if (mask.data.length !== mask.w * mask.h || !Number.isFinite(mask.score) || mask.score < MIN_MASK_SCORE) return false;
  let inside = 0;
  for (let i = 0; i < mask.data.length; i += 1) if (mask.data[i]) inside += 1;
  const coverage = inside / mask.data.length;
  return inside > 0 && coverage <= MAX_MASK_COVERAGE;
}

/** A detector box in picture pixels, as a box prompt in mask pixels. */
export function boxInMask(box: Region, pictureW: number, pictureH: number, mask: { w: number; h: number }): Region {
  const sx = mask.w / pictureW;
  const sy = mask.h / pictureH;
  return { x: box.x * sx, y: box.y * sy, w: box.w * sx, h: box.h * sy };
}

/**
 * The Laplacian of an RGBA crop, averaged over the pixels inside the mask. `region` is where the crop sits in the
 * picture, in the picture's pixels; `pictureW`/`pictureH` relate that to the mask. Null when the mask does not
 * cover enough of the crop to say anything, so the caller keeps the box value.
 *
 * The scale is the box method's: an all-subject crop gives exactly boxSharpness.
 */
export function maskedSharpness(rgba: Uint8ClampedArray, width: number, height: number,
  mask: SubjectMaskPixels, region: Region, pictureW: number, pictureH: number): number | null {
  if (width < 4 || height < 4 || !(pictureW > 0 && pictureH > 0) || !(region.w > 0 && region.h > 0)) return null;
  if (rgba.length < width * height * 4 || mask.data.length !== mask.w * mask.h) return null;
  const luma = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i += 1) luma[i] = 0.213 * rgba[i * 4] + 0.715 * rgba[i * 4 + 1] + 0.072 * rgba[i * 4 + 2];
  const column = new Int32Array(width);
  for (let x = 0; x < width; x += 1) {
    const px = region.x + ((x + 0.5) / width) * region.w;
    column[x] = Math.min(mask.w - 1, Math.max(0, Math.floor((px / pictureW) * mask.w)));
  }
  let sum = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    const py = region.y + ((y + 0.5) / height) * region.h;
    const row = Math.min(mask.h - 1, Math.max(0, Math.floor((py / pictureH) * mask.h))) * mask.w;
    for (let x = 1; x < width - 1; x += 1) {
      if (!mask.data[row + column[x]]) continue;
      const i = y * width + x;
      sum += Math.abs(4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - width] - luma[i + width]);
      count += 1;
    }
  }
  if (count < MIN_MASK_PIXELS) return null;
  const value = sum / count;
  return Number.isFinite(value) ? value : null;
}
