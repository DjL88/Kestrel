import { sha256Hex } from '../core/sha256';
import { createOffThreadSession, type OffThreadSession } from './offThreadSession';
import { EMBED_MODEL, embeddingCrop, encodeEmbedding, preprocessEmbedding, type StoredEmbedding } from '../core/visualSimilarity';
import { friendlyToolError } from '../core/toolErrors';

/**
 * Runs the image-embedding model (DINOv2 ViT-S/14, fp16 ONNX, public/models) on this device, through the same
 * onnxruntime-web WASM runtime as the other models on every platform. The file ships with the app and is checked
 * against its length and SHA-256 before use; a mismatch means no embeddings, and grouping stays time-based.
 */
let loading: Promise<OffThreadSession> | null = null;

/** Runs in a worker (src/providers/offThreadSession.ts): on the page's own thread it held up the interface 1-4 s a photo. */
function load(): Promise<OffThreadSession> {
  loading ??= (async () => {
    const response = await fetch(EMBED_MODEL.url);
    if (!response.ok) throw new Error('The photo similarity model is missing. Reinstall InFlight.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    // The browser hashes off the interface thread (a pure-JS hash of this file froze the editor for about 3 s);
    // sha256Hex keeps the pure-JS fallback where crypto.subtle is switched off (plain http on a local network).
    if (bytes.byteLength !== EMBED_MODEL.bytes || await sha256Hex(bytes.buffer) !== EMBED_MODEL.sha256) {
      throw new Error('The photo similarity model failed its integrity check, so it was not used.');
    }
    return createOffThreadSession('dinov2-small-fp16', bytes);
  })().catch((error) => {
    loading = null;
    console.warn('Photo similarity model failed to load', error);
    throw new Error(friendlyToolError(error, 'photo similarity model'));
  });
  return loading;
}

/** The stored embedding for a picture, or null when the model gave no usable answer. */
export async function embedPicture(picture: HTMLCanvasElement): Promise<StoredEmbedding | null> {
  const session = await load();
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
  const results = await session.run({ pixel_values: { data: input, dims: [1, 3, size, size] } });
  const output = results.embedding ?? results[session.outputNames[0]];
  return encodeEmbedding(Float32Array.from(output.data as Float32Array));
}
