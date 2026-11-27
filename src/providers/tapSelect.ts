import { createOffThreadSession, type ModelTensor, type OffThreadSession } from './offThreadSession';
import { EFFICIENTSAM_TI } from '../core/optionalModels';
import { SAM_INPUT, bestSamMask, chooseSamMask, wholeSubjectTap, samInput, samMaskSize, samPoints, unionSamMasks, type SamBox, type SamMask, type SamPrompt } from '../core/efficientSam';
import { friendlyToolError } from '../core/toolErrors';
import { downloadOptionalModel, optionalModelStatus, readOptionalModelFile, removeOptionalModel, type OptionalModelStatus } from './optionalModels';

/**
 * Tap-to-select with EfficientSAM-Ti, an optional download. `encodePhoto` reads a photo once (the slow step: seconds
 * natively, far longer in single-thread WASM); `selectSubjects` then answers every tap from that encoding. Without
 * the pack nothing here runs, and the existing manual brush and U²-Netp subject mask stay as they are. Both halves run
 * in background workers (src/providers/offThreadSession.ts), so reading a photo never freezes the interface; where a
 * worker cannot start they run on this thread, as before.
 */
interface Loaded { encoder: OffThreadSession; decoder: OffThreadSession }
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
    // A worker that stops after loading drops both sessions, so the next reading or tap starts fresh ones.
    const onLost = () => { loading = null; };
    const [encoder, decoder] = await Promise.all([
      createOffThreadSession(`${EFFICIENTSAM_TI.id}.encoder`, encoderBytes, { onLost }),
      // The decoder also returns a shape (int64) the app does not read.
      createOffThreadSession(`${EFFICIENTSAM_TI.id}.decoder`, decoderBytes, { onLost, outputs: ['output_masks', 'iou_predictions'] }),
    ]);
    return { encoder, decoder };
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
interface Encoding { embedding: ModelTensor; mask: { w: number; h: number } }
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
  const { encoder } = await load();
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
  const out = await encoder.run({ batched_images: { data: input, dims: [1, 3, SAM_INPUT, SAM_INPUT] } });
  const embedding = out.image_embeddings;
  if (!embedding) throw new Error('The tap-to-select model returned an unexpected result.');
  encodings.set(key, { embedding, mask });
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
  const { decoder } = await load();
  const { embedding, mask } = encoded;
  const results: Array<SamMask | null> = [];
  for (const subject of subjects) {
    const points = samPoints(subject);
    if (!points) { results.push(null); continue; }
    const out = await decoder.run({
      image_embeddings: embedding,
      batched_point_coords: { data: points.coords, dims: [1, 1, points.count, 2] },
      batched_point_labels: { data: points.labels, dims: [1, 1, points.count] },
      orig_im_size: { data: BigInt64Array.from([BigInt(mask.h), BigInt(mask.w)]), dims: [2] },
    });
    if (!out.output_masks || !out.iou_predictions) throw new Error('The tap-to-select model returned an unexpected result.');
    // A first tap takes the whole subject; later taps refine it (core/efficientSam.ts chooseSamMask).
    results.push(chooseSamMask(out.output_masks.data, out.iou_predictions.data, mask.w, mask.h, wholeSubjectTap(subject)));
  }
  return results;
}

/**
 * Box-prompted masks for culling (x-std-mask-sharpness): reads one picture already at 1024 x 1024 and answers each box
 * (in mask pixels of `size`), without keeping the encoding, so the editor's kept encodings are never pushed out.
 */
export async function segmentBoxes(input: Float32Array, boxes: readonly SamBox[], size: { w: number; h: number }): Promise<Array<SamMask | null>> {
  const { encoder, decoder } = await load();
  const out = await encoder.run({ batched_images: { data: input, dims: [1, 3, SAM_INPUT, SAM_INPUT] } });
  const embedding = out.image_embeddings;
  if (!embedding) throw new Error('The tap-to-select model returned an unexpected result.');
  const masks: Array<SamMask | null> = [];
  for (const box of boxes) {
    const points = samPoints({ box });
    if (!points) { masks.push(null); continue; }
    const answer = await decoder.run({
      image_embeddings: embedding,
      batched_point_coords: { data: points.coords, dims: [1, 1, points.count, 2] },
      batched_point_labels: { data: points.labels, dims: [1, 1, points.count] },
      orig_im_size: { data: BigInt64Array.from([BigInt(size.h), BigInt(size.w)]), dims: [2] },
    });
    if (!answer.output_masks || !answer.iou_predictions) throw new Error('The tap-to-select model returned an unexpected result.');
    masks.push(bestSamMask(answer.output_masks.data, answer.iou_predictions.data, size.w, size.h));
  }
  return masks;
}

export { unionSamMasks };
