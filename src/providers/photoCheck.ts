import { factsFromDescription, supportedSceneFacts, type SceneFacts } from '../core/photoCheck';
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
  if (signal?.aborted) throw new DOMException('Photo check cancelled', 'AbortError');
  const started = performance.now();
  // Freeze the actual edited picture before asynchronous model loading.
  const pixels = previewPixels(source);
  const files = await readPhotoCheckFiles();
  if (signal?.aborted) throw new DOMException('Photo check cancelled', 'AbortError');
  if (!files) throw new Error('The photo check is not installed or could not be verified.');
  const ort = await import('onnxruntime-web/wasm');
  if (signal?.aborted) throw new DOMException('Photo check cancelled', 'AbortError');
  const vlm = await openSmolVlm(ort, files);
  const loaded = performance.now();
  try {
    if (signal?.aborted) throw new DOMException('Photo check cancelled', 'AbortError');
    // Claude measured very poor subject classification on this 256M checkpoint.
    // Descriptions are hypotheses; only independently corroborated lighting
    // may veto a conventional edit. Never turn text into a model instruction.
    const description = await vlm.describe(pixels, { signal, maxTokens: 28 });
    if (signal?.aborted) throw new DOMException('Photo check cancelled', 'AbortError');
    const facts = supportedSceneFacts(factsFromDescription(description), pixels);
    return { facts, description, loadMs: Math.round(loaded - started), inferMs: Math.round(performance.now() - loaded) };
  } finally { await vlm.dispose(); }
}
