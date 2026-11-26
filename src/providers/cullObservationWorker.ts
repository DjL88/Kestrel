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
 */
import { computeCullObservation, type Context2D } from './cullObservationCompute';
import { DETECTOR_MODEL } from '../core/objectDetection';

type Ort = typeof import('onnxruntime-web/wasm');
type Session = import('onnxruntime-web/wasm').InferenceSession;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

let ort: Ort | null = null;
let session: Session | null = null;

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
        const observation = await computeCullObservation(message.frameId, bitmap, makeContext, infer);
        scope.postMessage({ type: 'result', id: message.id, observation, runMs });
      } finally {
        bitmap.close();
      }
    }
  } catch (problem) {
    scope.postMessage({ type: 'error', id: message.id, message: problem instanceof Error ? problem.message : String(problem) });
  }
};
