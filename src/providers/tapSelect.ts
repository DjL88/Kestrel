import { createTimedSession } from './modelTiming';
import { EFFICIENTSAM_TI } from '../core/optionalModels';
import { SAM_INPUT, bestSamMask, samInput, samMaskSize, samPoints, unionSamMasks, type SamMask, type SamPrompt } from '../core/efficientSam';
import { friendlyToolError } from '../core/toolErrors';
import { downloadOptionalModel, optionalModelStatus, readOptionalModelFile, removeOptionalModel, type OptionalModelStatus } from './optionalModels';

/**
 * Tap-to-select with EfficientSAM-Ti, an optional download. `encodePhoto` reads a photo once (the slow step: seconds
 * natively, far longer in single-thread WASM); `selectSubjects` then answers every tap from that encoding. Without
 * the pack nothing here runs, and the existing manual brush and U²-Netp subject mask stay as they are.
 */
type Ort = typeof import('onnxruntime-web/wasm');
type Session = import('onnxruntime-web/wasm').InferenceSession;
type Tensor = import('onnxruntime-web/wasm').Tensor;
interface Loaded { ort: Ort; encoder: Session; decoder: Session }
let loading: Promise<Loaded> | null = null;

export const tapSelectStatus = (): Promise<OptionalModelStatus> => optionalModelStatus(EFFICIENTSAM_TI);
export const downloadTapSelect = (onProgress: (fraction: number) => void, signal?: AbortSignal) =>
  downloadOptionalModel(EFFICIENTSAM_TI, onProgress, signal);
export async function removeTapSelect(): Promise<void> { loading = null; encodings.clear(); await removeOptionalModel(EFFICIENTSAM_TI); }

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const [encoderBytes, decoderBytes] = await Promise.all([
      readOptionalModelFile(EFFICIENTSAM_TI, 'encoder'), readOptionalModelFile(EFFICIENTSAM_TI, 'decoder'),
    ]);
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const options = { executionProviders: ['wasm'] };
    const [encoder, decoder] = await Promise.all([
      createTimedSession(ort, `${EFFICIENTSAM_TI.id}.encoder`, encoderBytes, options), createTimedSession(ort, `${EFFICIENTSAM_TI.id}.decoder`, decoderBytes, options),
    ]);
    return { ort, encoder, decoder };
  })().catch((error) => {
    loading = null;
    console.warn('Tap-to-select failed to load', error);
    throw new Error(friendlyToolError(error, 'tap-to-select model'));
  });
  return loading;
}

type Source = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
const dims = (source: Source) => source instanceof HTMLImageElement ? { w: source.naturalWidth, h: source.naturalHeight } : { w: source.width, h: source.height };

/**
 * Encodings kept for the last few photos (about 4 MB each), keyed by the caller (for example the original's SHA-256
 * and the crop). Encoding is the slow step, so a background queue should call `encodePhoto` ahead of the photographer
 * (the photo on screen first, then its neighbours); a tap then needs only the fast decoder.
 */
export const KEPT_ENCODINGS = 4;
interface Encoding { embedding: Tensor; mask: { w: number; h: number } }
const encodings = new Map<string, Encoding>();
const pending = new Map<string, Promise<{ w: number; h: number }>>();

/** Is this photo already encoded, so a tap will answer at decoder speed? */
export const isPhotoEncoded = (key: string) => encodings.has(key);

/**
 * Read a photo once. Masks will come back at `samMaskSize` of the photo (long edge at most 1024), and taps must be
 * given in those mask pixels. A second call with the same key reuses the encoding.
 */
export async function encodePhoto(source: Source, key: string): Promise<{ w: number; h: number }> {
  const kept = encodings.get(key);
  if (kept) { encodings.delete(key); encodings.set(key, kept); return kept.mask; }
  const running = pending.get(key);
  if (running) return running;
  const job = encode(source, key).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

async function encode(source: Source, key: string): Promise<{ w: number; h: number }> {
  const { ort, encoder } = await load();
  const { w, h } = dims(source);
  const mask = samMaskSize(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = SAM_INPUT;
  canvas.height = SAM_INPUT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, w, h, 0, 0, SAM_INPUT, SAM_INPUT);
  const input = samInput(context.getImageData(0, 0, SAM_INPUT, SAM_INPUT).data);
  const out = await encoder.run({ batched_images: new ort.Tensor('float32', input, [1, 3, SAM_INPUT, SAM_INPUT]) });
  encodings.set(key, { embedding: out.image_embeddings, mask });
  while (encodings.size > KEPT_ENCODINGS) {
    const oldest = encodings.keys().next().value as string;
    encodings.delete(oldest);
  }
  return mask;
}

/**
 * One mask per subject, in the order given, from the photo encoded with `key`. A subject with nothing to go on
 * (no box and no added tap) gives null. Several subjects are separate masks; `unionSamMasks` joins them when one
 * layer is wanted.
 */
export async function selectSubjects(key: string, subjects: readonly SamPrompt[]): Promise<Array<SamMask | null>> {
  const encoded = encodings.get(key);
  if (!encoded) throw new Error('This photo has not been read for tap-to-select yet.');
  const { ort, decoder } = await load();
  const { embedding, mask } = encoded;
  const results: Array<SamMask | null> = [];
  for (const subject of subjects) {
    const points = samPoints(subject);
    if (!points) { results.push(null); continue; }
    const out = await decoder.run({
      image_embeddings: embedding,
      batched_point_coords: new ort.Tensor('float32', points.coords, [1, 1, points.count, 2]),
      batched_point_labels: new ort.Tensor('float32', points.labels, [1, 1, points.count]),
      orig_im_size: new ort.Tensor('int64', BigInt64Array.from([BigInt(mask.h), BigInt(mask.w)]), [2]),
    });
    results.push(bestSamMask(out.output_masks.data as Float32Array, out.iou_predictions.data as Float32Array, mask.w, mask.h));
  }
  return results;
}

export { unionSamMasks };
