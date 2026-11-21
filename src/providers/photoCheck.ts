import { factsFromDescription, type SceneFacts } from '../core/photoCheck';
import { IMAGE_EDGE } from '../core/smolvlm';
import { openSmolVlm } from './smolvlmRuntime';
import { readPhotoCheckFiles } from './photoCheckStore';

export interface PhotoCheckResult { facts: SceneFacts; description: string; loadMs: number; inferMs: number }

/** The preview, stretched to the 512 x 512 the vision model takes (the same colour-managed pixels the photographer sees). */
export function previewPixels(source: CanvasImageSource): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = IMAGE_EDGE;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, IMAGE_EDGE, IMAGE_EDGE);
  return context.getImageData(0, 0, IMAGE_EDGE, IMAGE_EDGE).data;
}

/**
 * One on-device check. The model loads for this check and is released after it, so memory is only held while it runs.
 * No network is used: the files come from the verified store. Cancellation stops between decoding steps.
 */
export async function runPhotoCheck(source: CanvasImageSource, signal?: AbortSignal): Promise<PhotoCheckResult> {
  const started = performance.now();
  const files = await readPhotoCheckFiles();
  if (!files) throw new Error('The photo check is not installed.');
  const ort = await import('onnxruntime-web/wasm');
  const vlm = await openSmolVlm(ort, files);
  const loaded = performance.now();
  try {
    const description = await vlm.describe(previewPixels(source), { signal, maxTokens: 28 });
    return { facts: factsFromDescription(description), description, loadMs: Math.round(loaded - started), inferMs: Math.round(performance.now() - loaded) };
  } finally { await vlm.dispose(); }
}
