import { factsFromDescription, supportedSceneFacts, type SceneFacts } from '../core/photoCheck';
import { IMAGE_EDGE } from '../core/smolvlm';
import { placePhotoInsideSquare } from '../core/photoCheckPlacement';
import { createSerialInferenceQueue } from '../core/serialInference';
import { corroborateSubject, detectorWitness, modelWitness, type Corroboration } from '../core/subjectCorroboration';
import { openSmolVlm } from './smolvlmRuntime';
import { readPhotoCheckFiles } from './photoCheckStore';

export interface PhotoCheckResult { facts: SceneFacts; /** Whether the scene reading and the object detector agree about the subject. */ subject: Corroboration; description: string; loadMs: number; inferMs: number }

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
/**
 * What the existing object detector sees in the same frozen preview the scene reading saw. A detector that cannot run
 * is simply no witness: it must never stop the check. Cancellation is the only thing allowed to escape.
 */
async function detectorSaw(pixels: Uint8ClampedArray, signal?: AbortSignal): Promise<{ label: string; score: number } | null> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = IMAGE_EDGE;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), IMAGE_EDGE, IMAGE_EDGE), 0, 0);
    const { findSubject } = await import('./objectDetector');
    const found = await findSubject(canvas, signal);
    return found ? { label: found.detection.label, score: found.detection.score } : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

const oneInferenceAtATime = createSerialInferenceQueue();
const ensureCurrent = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Photo check cancelled', 'AbortError');
};

export async function runPhotoCheck(source: CanvasImageSource, signal?: AbortSignal): Promise<PhotoCheckResult> {
  return oneInferenceAtATime(async () => {
    ensureCurrent(signal);
    const started = performance.now();
    // Freeze the currently edited pixels before asynchronous model startup.
    const pixels = previewPixels(source);
    const files = await readPhotoCheckFiles();
    ensureCurrent(signal);
    if (!files) throw new Error('The photo check is not installed or could not be verified.');
    const ort = await import('onnxruntime-web/wasm');
    ensureCurrent(signal);
    const vlm = await openSmolVlm(ort, files);
    const loaded = performance.now();
    try {
      ensureCurrent(signal);
      const description = await vlm.describe(pixels, { signal, maxTokens: 28 });
      ensureCurrent(signal);
      const subject = corroborateSubject(modelWitness(description), detectorWitness(await detectorSaw(pixels, signal)));
      ensureCurrent(signal);
      return { facts: supportedSceneFacts(factsFromDescription(description), pixels), subject, description,
        loadMs: Math.round(loaded - started), inferMs: Math.round(performance.now() - loaded) };
    } finally {
      // The queue cannot release the next photo until these large WASM graphs
      // have been disposed, including when inference fails or is cancelled.
      await vlm.dispose();
    }
  }, signal);
}
