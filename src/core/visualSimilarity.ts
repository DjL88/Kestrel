/**
 * Visual similarity from DINOv2 ViT-S/14 image embeddings (Meta, Apache-2.0; converted to fp16 ONNX and gated against
 * the original: cosine >= 0.99999, identical nearest neighbours). Used only to refine burst grouping: time decides
 * first, similarity may split a burst at a real scene change or join look-alike frames that have no capture time.
 * It never decides keep or reject, and a photo without an embedding is grouped exactly as before.
 */

const env = (import.meta as { env?: Record<string, string | undefined> }).env;
export const EMBED_MODEL = {
  id: 'dinov2-small-fp16',
  /** In public/models, so it ships with every build; the app reads it from its own files only. */
  url: env?.VITE_EMBED_MODEL_URL ?? '/models/dinov2-small-fp16.onnx',
  sha256: env?.VITE_EMBED_MODEL_SHA256 ?? '31194260449c7916c6e08b87bb44b7a36950d7eab0dffc41ae1bdff33c950bc8',
  bytes: Number(env?.VITE_EMBED_MODEL_BYTES ?? 44904414),
  size: 224,
  dims: 384,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
} as const;

/** A stored embedding: int8 values with one scale, base64 (384 bytes per photo). Tagged with the model that made it. */
export interface StoredEmbedding { model: string; v: string; scale: number }

/**
 * Thresholds on cosine similarity, from 24 Nov 2026 calibration on 479 of the owner's own NEF previews across four
 * shoots (kingfishers, dog show, low-flying jets, kites; numbers only, no photos left the device):
 * consecutive frames within 1.5 s: p1 0.49, p5 0.61, median 0.91; unrelated photos from different shoots: p99 0.30.
 * Split only below 0.35 (as different as unrelated photos), so fast panning stays one burst; join untimed frames only
 * above 0.92 (above a typical burst neighbour). Re-measure when the model changes.
 */
export const SCENE_CHANGE_BELOW = 0.35;
export const LOOK_ALIKE_ABOVE = 0.92;

/** Planar float input, ImageNet mean and standard deviation, from a size x size RGBA square. */
export function preprocessEmbedding(rgba: Uint8ClampedArray, size: number = EMBED_MODEL.size): Float32Array {
  const plane = size * size;
  if (rgba.length < plane * 4) throw new RangeError('The picture is smaller than the model input.');
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      out[channel * plane + i] = (rgba[i * 4 + channel] / 255 - EMBED_MODEL.mean[channel]) / EMBED_MODEL.std[channel];
    }
  }
  return out;
}

/** Resize-shorter-side-to-256 then centre 224 crop, as the model was trained: where to cut from the source. */
export function embeddingCrop(width: number, height: number): { x: number; y: number; size: number } {
  const size = Math.round(Math.min(width, height) * (EMBED_MODEL.size / 256));
  return { x: Math.round((width - size) / 2), y: Math.round((height - size) / 2), size };
}

const finite = (vector: ArrayLike<number>) => {
  for (let i = 0; i < vector.length; i += 1) if (!Number.isFinite(vector[i])) return false;
  return true;
};

/** int8-quantise a model output for storage. Corrupt (non-finite or empty) output returns null and is not stored. */
export function encodeEmbedding(vector: Float32Array, model: string = EMBED_MODEL.id): StoredEmbedding | null {
  if (vector.length !== EMBED_MODEL.dims || !finite(vector)) return null;
  let peak = 0;
  for (const value of vector) peak = Math.max(peak, Math.abs(value));
  if (peak === 0) return null;
  const scale = peak / 127;
  let binary = '';
  for (const value of vector) {
    const q = Math.max(-127, Math.min(127, Math.round(value / scale)));
    binary += String.fromCharCode(q < 0 ? q + 256 : q);
  }
  return { model, v: btoa(binary), scale };
}

/** Back to a unit vector. Anything malformed, or from another model, returns null: no similarity evidence. */
export function decodeEmbedding(stored: StoredEmbedding | undefined, model: string = EMBED_MODEL.id): Float32Array | null {
  if (!stored || stored.model !== model || !Number.isFinite(stored.scale) || stored.scale <= 0 || typeof stored.v !== 'string') return null;
  let binary: string;
  try { binary = atob(stored.v); } catch { return null; }
  if (binary.length !== EMBED_MODEL.dims) return null;
  const out = new Float32Array(binary.length);
  let sum = 0;
  for (let i = 0; i < binary.length; i += 1) {
    const byte = binary.charCodeAt(i);
    out[i] = (byte > 127 ? byte - 256 : byte) * stored.scale;
    sum += out[i] * out[i];
  }
  const length = Math.sqrt(sum);
  if (!length) return null;
  for (let i = 0; i < out.length; i += 1) out[i] /= length;
  return out;
}

/** Cosine similarity of two unit vectors; null when either is missing. */
export function similarity(a: Float32Array | null, b: Float32Array | null): number | null {
  if (!a || !b || a.length !== b.length) return null;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

/** Is this stored embedding usable and current? A photo without one is embedded in the background. */
export function hasCurrentEmbedding(stored: StoredEmbedding | undefined): boolean {
  return decodeEmbedding(stored) !== null;
}
