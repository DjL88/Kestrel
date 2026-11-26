/**
 * One culling worker (x-std-parallel-preflight). It decodes a preview with createImageBitmap, scores it at 256 px,
 * runs its own copy of the checked subject detector and posts back only the numeric observation: no pixels, no
 * image objects. Several of these run at once (src/providers/cullObservationPool.ts), so a shoot is looked at on
 * every core but one while the interface thread stays free.
 *
 *   in  { type: 'init', model? }               out { type: 'ready', loadMs } or { type: 'error', message }
 *   in  { type: 'run', id, frameId, blob, tryDetector }
 *                                              out { type: 'result', id, observation, runMs } or { type: 'error', id, message }
 * `model` is the checked file's bytes; without it the worker scores detail only. runMs lists each detector run.
 * `mask` ({ encoder, decoder }: the EfficientSAM-Ti pack's bytes) is sent only with the masked-sharpness preview on
 * (x-std-mask-sharpness); each subject's sharpness is then measured inside its box-prompted mask.
 */
import { computeCullObservation, type Context2D, type Segment } from './cullObservationCompute';
import { DETECTOR_MODEL } from '../core/objectDetection';
import { SAM_INPUT, bestSamMask, samPoints } from '../core/efficientSam';

type Ort = typeof import('onnxruntime-web/wasm');
type Session = import('onnxruntime-web/wasm').InferenceSession;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

let ort: Ort | null = null;
let session: Session | null = null;
let samEncoder: Session | null = null;
let samDecoder: Session | null = null;

const segment: Segment = async (input, boxes, size) => {
  const o = ort!;
  const encoded = await samEncoder!.run({ batched_images: new o.Tensor('float32', input, [1, 3, SAM_INPUT, SAM_INPUT]) });
  const embedding = encoded.image_embeddings;
  if (!embedding) throw new Error('The selection model returned an unexpected result.');
  const masks = [];
  for (const box of boxes) {
    const points = samPoints({ box });
    if (!points) { masks.push(null); continue; }
    const out = await samDecoder!.run({
      image_embeddings: embedding,
      batched_point_coords: new o.Tensor('float32', points.coords, [1, 1, points.count, 2]),
      batched_point_labels: new o.Tensor('float32', points.labels, [1, 1, points.count]),
      orig_im_size: new o.Tensor('int64', BigInt64Array.from([BigInt(size.h), BigInt(size.w)]), [2]),
    });
    const data = out.output_masks?.data;
    const scores = out.iou_predictions?.data;
    if (!(data instanceof Float32Array) || !(scores instanceof Float32Array)) throw new Error('The selection model returned an unexpected result.');
    masks.push(bestSamMask(data, scores, size.w, size.h));
  }
  return masks;
};

const makeContext = (width: number, height: number): Context2D | null =>
  new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true }) as unknown as Context2D | null;

scope.onmessage = async (event: MessageEvent) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined' ||
          !new OffscreenCanvas(1, 1).getContext('2d')) throw new Error('This browser cannot decode pictures in a worker.');
      const started = performance.now();
      if (message.model) {
        ort = await import('onnxruntime-web/wasm');
        ort.env.wasm.numThreads = 1; // One thread per worker: the workers share the cores without cross-origin isolation.
        ort.env.wasm.proxy = false;
        session = await ort.InferenceSession.create(new Uint8Array(message.model as ArrayBuffer), { executionProviders: ['wasm'] });
      }
      if (message.mask && ort) {
        // A mask pack that will not load only means box sharpness, as without the preview.
        try {
          samEncoder = await ort.InferenceSession.create(new Uint8Array(message.mask.encoder as ArrayBuffer), { executionProviders: ['wasm'] });
          samDecoder = await ort.InferenceSession.create(new Uint8Array(message.mask.decoder as ArrayBuffer), { executionProviders: ['wasm'] });
        } catch {
          samEncoder = null;
          samDecoder = null;
        }
      }
      scope.postMessage({ type: 'ready', loadMs: performance.now() - started });
    } else if (message.type === 'run') {
      const runMs: number[] = [];
      const bitmap = await createImageBitmap(message.blob as Blob, { imageOrientation: 'from-image' });
      try {
        const size = DETECTOR_MODEL.inputSize;
        const infer = message.tryDetector && ort && session ? async (input: Float32Array) => {
          const started = performance.now();
          const results = await session!.run({ [session!.inputNames[0]]: new ort!.Tensor('float32', input, [1, 3, size, size]) });
          runMs.push(performance.now() - started);
          const data = results[session!.outputNames[0]]?.data;
          if (!(data instanceof Float32Array)) throw new Error('The subject detector returned an unexpected result.');
          return data;
        } : message.tryDetector ? async (): Promise<Float32Array> => { throw new Error('The subject detector is not loaded.'); } : null;
        const observation = await computeCullObservation(message.frameId, bitmap, makeContext, infer,
          infer && samEncoder && samDecoder ? segment : null);
        scope.postMessage({ type: 'result', id: message.id, observation, runMs });
      } finally {
        bitmap.close();
      }
    }
  } catch (problem) {
    scope.postMessage({ type: 'error', id: message.id, message: problem instanceof Error ? problem.message : String(problem) });
  }
};
