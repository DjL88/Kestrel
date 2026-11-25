import { createTimedSession } from './modelTiming';
import { Sha256Stream } from '../core/sha256';
import { EMBED_MODEL, embeddingCrop, encodeEmbedding, preprocessEmbedding, type StoredEmbedding } from '../core/visualSimilarity';
import { friendlyToolError } from '../core/toolErrors';

/**
 * Runs the image-embedding model (DINOv2 ViT-S/14, fp16 ONNX, public/models) on this device, through the same
 * onnxruntime-web WASM runtime as the other models on every platform. The file ships with the app and is checked
 * against its length and SHA-256 before use; a mismatch means no embeddings, and grouping stays time-based.
 */
type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded { ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession }
let loading: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const response = await fetch(EMBED_MODEL.url);
    if (!response.ok) throw new Error('The photo similarity model is missing. Reinstall InFlight.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const hash = new Sha256Stream();
    hash.update(bytes);
    if (bytes.byteLength !== EMBED_MODEL.bytes || hash.digest() !== EMBED_MODEL.sha256) {
      throw new Error('The photo similarity model failed its integrity check, so it was not used.');
    }
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await createTimedSession(ort, 'dinov2-small-fp16', bytes, { executionProviders: ['wasm'] });
    return { ort, session };
  })().catch((error) => {
    loading = null;
    console.warn('Photo similarity model failed to load', error);
    throw new Error(friendlyToolError(error, 'photo similarity model'));
  });
  return loading;
}

/** The stored embedding for a picture, or null when the model gave no usable answer. */
export async function embedPicture(picture: HTMLCanvasElement): Promise<StoredEmbedding | null> {
  const { ort, session } = await load();
  const size = EMBED_MODEL.size;
  const crop = embeddingCrop(picture.width, picture.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, crop.x, crop.y, crop.size, crop.size, 0, 0, size, size);
  const input = preprocessEmbedding(context.getImageData(0, 0, size, size).data, size);
  const results = await session.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, size, size]) });
  const output = results.embedding ?? results[session.outputNames[0]];
  return encodeEmbedding(Float32Array.from(output.data as Float32Array));
}
