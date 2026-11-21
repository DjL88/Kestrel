import { factsFromDescription, type SceneFacts } from '../core/photoCheck';
import { IMAGE_EDGE } from '../core/smolvlm';
import { placePhotoInsideSquare } from '../core/photoCheckPlacement';
import { openSmolVlm } from './smolvlmRuntime';
import { readPhotoCheckFiles } from './photoCheckStore';

export interface PhotoCheckResult { facts: SceneFacts; description: string; loadMs: number; inferMs: number }

/** Letterbox the displayed preview without distorting subject proportions. Never change source pixels. */
export function previewPixels(source: CanvasImageSource): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = IMAGE_EDGE;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.imageSmoothingQuality = 'high';
  const { width, height } = source as { width?: number; height?: number };
  const bounds = placePhotoInsideSquare(width ?? 0, height ?? 0, IMAGE_EDGE);
  // Neutral padding avoids introducing dark/artificial sky or black-band
  // cues into the model's photographic scene reading.
  context.fillStyle = '#808080';
  context.fillRect(0, 0, IMAGE_EDGE, IMAGE_EDGE);
  context.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height);
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
