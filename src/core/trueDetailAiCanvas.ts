import { layerImage } from './layerAssetVault';
import { blendLearned, trueDetailAiPlacement, trueDetailAiWeight } from './trueDetailAi';
import type { MaskContext } from './masks';
import type { PhotoEdit } from './photoEdits';

/** The message a strict render (export) gives when the stored AI denoise result is not on this device. */
export const TRUEDETAIL_AI_MISSING = 'This photo uses an AI denoise result that is not on this device, so nothing was exported. Run Denoise again on this device, or turn the AI denoise off.';

const ready = new Map<string, ImageBitmap>();

/** Decode the stored AI result so a synchronous render can use it. Resolves false when this device does not have it. */
export async function preloadTrueDetailAi(edit: PhotoEdit | undefined): Promise<boolean> {
  const asset = edit?.trueDetailAi?.asset;
  if (!asset) return true;
  if (ready.has(asset)) return true;
  const image = await layerImage(asset);
  if (!image) return false;
  ready.set(asset, image);
  // Keep a handful decoded: the open photo, its neighbours and an export in progress.
  while (ready.size > 6) ready.delete(ready.keys().next().value as string);
  return true;
}

/** Whether a synchronous render can include this edit's AI result now. */
export const trueDetailAiReady = (edit: PhotoEdit | undefined) => !edit?.trueDetailAi || ready.has(edit.trueDetailAi.asset);

/**
 * Blend the stored AI result into the canvas, first, on the photo's own pixels. Strict (export) refuses when the
 * result is missing; the interactive view draws without it, and the editor says so.
 */
export function applyCanvasTrueDetailAi(canvas: HTMLCanvasElement, edit: PhotoEdit, context: MaskContext, strict: boolean): void {
  const ai = edit.trueDetailAi;
  if (!ai) return;
  const image = ready.get(ai.asset);
  if (!image) {
    if (strict) throw new Error(TRUEDETAIL_AI_MISSING);
    return;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas unavailable');
  const place = trueDetailAiPlacement(ai, canvas.width, canvas.height, context);
  const layer = document.createElement('canvas');
  layer.width = canvas.width; layer.height = canvas.height;
  const lctx = layer.getContext('2d', { willReadFrequently: true });
  if (!lctx) throw new Error('Canvas unavailable');
  lctx.imageSmoothingQuality = 'high';
  lctx.drawImage(image, place.x, place.y, place.w, place.h);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const learned = lctx.getImageData(0, 0, canvas.width, canvas.height, { colorSpace: pixels.colorSpace });
  blendLearned(pixels.data, learned.data, trueDetailAiWeight(ai, edit.masks, canvas.width, canvas.height, context));
  ctx.putImageData(pixels, 0, 0);
  layer.width = 0; layer.height = 0;
}
