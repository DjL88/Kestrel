import { denoiseChromaRGBA } from './naturalChromaDenoise';
import type { PhotoEdit } from './photoEdits';

/** How strongly the colour filter blends in for a slider position of 0 to 2. */
export const noiseStrength = (denoise: number | undefined) => Math.min(1, Math.max(0, (denoise ?? 0) / 2));

export const hasNoiseReduction = (edit: PhotoEdit) => noiseStrength(edit.denoise) > 0;

/** Largest frame the colour filter will run on. Beyond it the photo is left as it is, never half-processed. */
const MAX_PIXELS = 80_000_000;

/**
 * Colour noise reduction on the original (unedited) pixels, so tone and sharpening never amplify the speckle.
 * Edges and fine luminance texture are untouched: only colour is smoothed. Returns the input when nothing is to be done.
 * Past the first half of the slider the wider 5 x 5 neighbourhood is used.
 */
export function applyNoiseReduction(pixels: Uint8ClampedArray, width: number, height: number, edit: PhotoEdit): Uint8ClampedArray {
  const strength = noiseStrength(edit.denoise);
  if (strength === 0 || width * height > MAX_PIXELS) return pixels;
  return denoiseChromaRGBA(pixels, width, height, { strength, radius: (edit.denoise ?? 0) > 1 ? 2 : 1 });
}
