import { denoiseChromaRGBA } from './naturalChromaDenoise';
import { denoiseChromaLinearRGB } from './naturalChromaDenoiseLinear';
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

/**
 * Scene-linear floating-point colour noise reduction on an interleaved RGBA Float32Array.
 * Keeps highlights, shadow gradation, and alpha intact without 8-bit quantization before tone/detail passes.
 */
export function applyNoiseReductionLinearRGBA(
  linearRgba: Float32Array,
  width: number,
  height: number,
  edit: PhotoEdit,
): Float32Array {
  const strength = noiseStrength(edit.denoise);
  if (strength === 0 || width * height > MAX_PIXELS) return linearRgba;
  const count = width * height;
  const rgb = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    rgb[i * 3] = linearRgba[i * 4];
    rgb[i * 3 + 1] = linearRgba[i * 4 + 1];
    rgb[i * 3 + 2] = linearRgba[i * 4 + 2];
  }
  const cleaned = denoiseChromaLinearRGB(rgb, width, height, { strength, radius: (edit.denoise ?? 0) > 1 ? 2 : 1 });
  const out = new Float32Array(linearRgba.length);
  for (let i = 0; i < count; i += 1) {
    out[i * 4] = cleaned[i * 3];
    out[i * 4 + 1] = cleaned[i * 3 + 1];
    out[i * 4 + 2] = cleaned[i * 3 + 2];
    out[i * 4 + 3] = linearRgba[i * 4 + 3];
  }
  return out;
}
