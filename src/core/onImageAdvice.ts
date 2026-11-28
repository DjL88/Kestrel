import { clippingMap, type ClippingMap } from './clippingMap';
import { checkSubjectColour, type ColourSenseResult } from './colourSense';
import type { Pixels } from './colourCheck';
import { DEFAULT_FRAMING, type PhotoFraming } from './photoFraming';

/**
 * Everything the on-image advice layer draws, measured once from the preview-sized pictures of a photo: where the
 * highlights and shadows clip (in the edited picture) and whether the edit kept the main subject's colour. Read-only
 * advice: nothing here edits a photo, and anything that cannot be measured is left out, never filled in.
 */
export interface OnImageAdvice {
  clipping: ClippingMap | null;
  colour: ColourSenseResult;
  /** Whether the photo's framing left the picture whole when this was measured (see `framingIsWhole`); the eye and subject are only placed then. */
  framingWhole?: boolean;
}

/** A subject box in fractions of the picture, top-left origin (the shape the subject finder reports). */
export interface SubjectBox { x: number; y: number; width: number; height: number }

/**
 * The subject finder reports its box and its eye on the whole preview, so they are only valid while the framing leaves
 * the picture whole (no ratio, turn, straighten or size). Anything placed from them is dropped otherwise.
 */
export const framingIsWhole = (framing: PhotoFraming | undefined): boolean => {
  const f = framing ?? DEFAULT_FRAMING;
  return f.ratio === null && f.turns === 0 && f.straighten === 0 && (f.size === undefined || f.size === 1);
};

/** Weights for `checkSubjectColour`: 1 inside the box, 0 outside. Null when the box is missing or empty. */
export function subjectWeights(box: SubjectBox | null | undefined, width: number, height: number): Float32Array | null {
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite) || !(box.width > 0 && box.height > 0)) return null;
  const left = Math.max(0, Math.floor(box.x * width)), right = Math.min(width, Math.ceil((box.x + box.width) * width));
  const top = Math.max(0, Math.floor(box.y * height)), bottom = Math.min(height, Math.ceil((box.y + box.height) * height));
  if (right <= left || bottom <= top) return null;
  const weights = new Float32Array(width * height);
  for (let y = top; y < bottom; y += 1) weights.fill(1, y * width + left, y * width + right);
  return weights;
}

/**
 * @param before the picture without the edit, @param after the same picture with it (same size, same framing).
 * @param subject where the main subject is, or null: with none, the colour is "unknown", not guessed.
 */
export function measureOnImageAdvice(before: Pixels, after: Pixels, subject: SubjectBox | null): OnImageAdvice {
  const weights = subjectWeights(subject, after.width, after.height);
  return {
    clipping: clippingMap(after),
    colour: weights ? checkSubjectColour(before, after, weights) : { verdict: 'unknown', reason: 'noSubject' },
  };
}
