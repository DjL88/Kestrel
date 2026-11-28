import { engineText } from '../../i18n/areas/engine';
import { NAFNET_W32 } from '../../core/optionalModels';
import { drawFramedPhoto, framedSize, type PhotoFraming } from '../../core/photoFraming';
import { denoiseWithNafnet, nafnetStatus } from '../../providers/nafnetDenoise';
import { alphaForArea, subjectRect } from '../../core/trueDetailAi';
import type { Pixels } from '../../core/colourCheck';

/** The largest subject area (full-size pixels) the learned denoiser runs on: about 80 tiles, a few minutes on one
 * CPU thread. A larger subject is left to the conventional denoise and the note says so. Never downsampled. */
export const LEARNED_MAX_PIXELS = 3_000_000;

/** Plain account of why the learned denoise did not run on a big subject area. Never implies it ran at lower size. */
export function learnedTooLargeNote(width: number, height: number): string {
  const mp = (width * height / 1e6).toFixed(1);
  return `The learned denoise did not run: the subject's area is ${width} × ${height} pixels (${mp} MP) and it works on up to ${LEARNED_MAX_PIXELS / 1e6} MP at full size. Nothing was shrunk to fit. The built-in denoise was compared on its own; a tighter subject outline brings the area under the limit.`;
}

export interface LearnedSubject {
  model: string;
  modelSha256: string;
  /** Where the result sits, 0 to 1 of the framed photo. */
  rect: { x: number; y: number; w: number; h: number };
  /** The full-size result for that area, as a picture to store. */
  png: () => Promise<Blob>;
  /** The same result drawn into a working-size picture (transparent outside the area), for the guardian. */
  working: Uint8ClampedArray;
  /** The area at full size before and after, and the subject over it, so the result is also judged where it was made. */
  fullSize: { original: Pixels; learned: Pixels; alpha: Float32Array };
}

export type LearnedOutcome = { kind: 'ready'; result: LearnedSubject } | { kind: 'skipped'; note: string } | { kind: 'unavailable' };

/**
 * Run the learned denoiser (NAFNet, when its opt-in pack is on this device) on the subject's area at full size.
 * Nothing runs, and nothing is downloaded, when the pack is absent.
 */
export async function runLearnedOnSubject(
  source: HTMLImageElement, framing: PhotoFraming, working: { width: number; height: number }, subjectAlpha: Float32Array,
  signal?: AbortSignal, progress?: (done: number, total: number) => void,
): Promise<LearnedOutcome> {
  if (await nafnetStatus() !== 'ready') return { kind: 'unavailable' };
  const rect = subjectRect(subjectAlpha, working.width, working.height);
  if (!rect) return { kind: 'skipped', note: 'No subject area was found for the learned denoise.' };
  const framed = framedSize(source.naturalWidth, source.naturalHeight, framing);
  const region = {
    x: Math.floor(rect.x * framed.width), y: Math.floor(rect.y * framed.height),
    width: Math.max(1, Math.ceil(rect.w * framed.width)), height: Math.max(1, Math.ceil(rect.h * framed.height)),
  };
  region.width = Math.min(region.width, framed.width - region.x);
  region.height = Math.min(region.height, framed.height - region.y);
  if (region.width * region.height > LEARNED_MAX_PIXELS) {
    return { kind: 'skipped', note: learnedTooLargeNote(region.width, region.height) };
  }
  const crop = document.createElement('canvas');
  drawFramedPhoto(source, crop, framing, { region });
  const context = crop.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  const pixels = context.getImageData(0, 0, crop.width, crop.height);
  const count = crop.width * crop.height;
  const rgb16 = new Uint16Array(count * 3);
  for (let p = 0; p < count; p++) for (let c = 0; c < 3; c++) rgb16[p * 3 + c] = pixels.data[p * 4 + c] * 257;
  const before = new Uint8ClampedArray(pixels.data);
  let out: Uint16Array | null;
  try {
    out = await denoiseWithNafnet(rgb16, crop.width, crop.height, { strength: 1, signal, progress });
  } catch (problem) {
    signal?.throwIfAborted();
    // It runs only in a worker; where none can run it, the built-in denoise is compared alone (never run on the page).
    if (/only run in the background/.test(String(problem))) return { kind: 'skipped', note: engineText.denoise.learnedNoWorker };
    throw problem;
  }
  signal?.throwIfAborted();
  if (!out) return { kind: 'unavailable' };
  for (let p = 0; p < count; p++) {
    for (let c = 0; c < 3; c++) pixels.data[p * 4 + c] = Math.round(out[p * 3 + c] / 257);
    pixels.data[p * 4 + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const placed = { x: region.x / framed.width, y: region.y / framed.height, w: region.width / framed.width, h: region.height / framed.height };
  const fullSize = {
    original: { data: before, width: crop.width, height: crop.height },
    learned: { data: new Uint8ClampedArray(pixels.data), width: crop.width, height: crop.height },
    alpha: alphaForArea(subjectAlpha, working.width, working.height, placed, crop.width, crop.height),
  };
  const layer = document.createElement('canvas');
  layer.width = working.width; layer.height = working.height;
  const lctx = layer.getContext('2d', { willReadFrequently: true });
  if (!lctx) throw new Error('Canvas unavailable');
  lctx.imageSmoothingQuality = 'high';
  lctx.drawImage(crop, placed.x * working.width, placed.y * working.height, placed.w * working.width, placed.h * working.height);
  const workingPixels = lctx.getImageData(0, 0, working.width, working.height).data;
  layer.width = 0; layer.height = 0;
  return {
    kind: 'ready',
    result: {
      model: NAFNET_W32.id, modelSha256: NAFNET_W32.files.model.sha256, rect: placed, working: workingPixels, fullSize,
      png: () => new Promise<Blob>((resolve, reject) => crop.toBlob(blob => blob ? resolve(blob) : reject(new Error('The learned denoise result could not be stored.')), 'image/png')),
    },
  };
}
