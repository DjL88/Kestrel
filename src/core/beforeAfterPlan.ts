import type { ExportProfile } from './exportProfiles';

/** One authentic picture in two reversible states. Each half uses the ordinary export
 * crop and pixel pipeline, never an invented or independently generated image.
 */
export function beforeAfterPanelProfile(profile: ExportProfile): ExportProfile {
  if (profile.id !== 'before-after' || profile.format !== 'jpeg' ||
      !Number.isInteger(profile.width) || profile.width < 2 || profile.width % 2 !== 0 ||
      !Number.isInteger(profile.height) || profile.height < 1) {
    throw new Error('The before-and-after output format is invalid.');
  }
  return { ...profile, id: 'comparison-panel', prefix: '', width: profile.width / 2,
    allowUpscale: false, maxBytes: undefined };
}

/** A pair is never compressed to a secretly smaller output or upscaled.
 * Pixel counts and dimensions are checked before the final canvas allocation.
 */
export function beforeAfterCanvasSize(width: number, height: number, maximumPixels: number): { width: number; height: number } {
  const pairWidth = width * 2, pixels = pairWidth * height;
  if (![width, height, pairWidth, pixels, maximumPixels].every(Number.isSafeInteger) ||
      width < 1 || height < 1 || maximumPixels < 1 || pixels > maximumPixels) {
    throw new Error('This before-and-after image is too large for the device. Choose a smaller export or desktop.');
  }
  return { width: pairWidth, height };
}
