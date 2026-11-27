/**
 * Runs the subject-detection model off the interface thread, so the app stays usable while photos are scanned.
 * One model session per worker; several workers can run at once. Messages:
 *   in  { type: 'init', model, ort? }  (model: the checked file's bytes) out { type: 'ready', loadMs } or { type: 'error', message }
 *   in  { type: 'run', id, input, size }                out { type: 'result', id, data, runMs } or { type: 'error', id, message }
 *   in  { type: 'look', id, picture, tile }              out { type: 'found', id, detections, runMs } or { type: 'error', id, message }
 *   in  { type: 'sharpness', id, picture, box }          out { type: 'sharp', id, sharpness } or { type: 'error', id, message }
 * 'look' and 'sharpness' do the whole job here (drawing the tile, packing the model's input, reading its answer), so the
 * interface thread only sends the picture (an ImageBitmap) and receives the subjects.
 * The times go back to the interface thread for Settings → Models (src/core/modelStats.ts).
 */
import { createOrtSession, loadOrt, ortOptions, readOrtPlan } from './ortRuntime';
import { DETECTOR_MODEL, boxSharpness, decodeTile, sharpnessCrop, tileScale, toInput, type Box } from '../core/objectDetection';

/** One region of the picture drawn at a size, read back as RGBA, here in the worker. */
function pixelsOf(picture: ImageBitmap, region: Box, width: number, height: number): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, region.x, region.y, region.w, region.h, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

type Ort = typeof import('onnxruntime-web/wasm');
type Session = import('onnxruntime-web/wasm').InferenceSession;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

let ort: Ort | null = null;
let session: Session | null = null;

scope.onmessage = async (event: MessageEvent) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      // The page sends the plan (src/core/ortThreads.ts): one thread on the web and phones, a share of the cores on the isolated desktop app.
      const plan = readOrtPlan(message.ort);
      ort = await loadOrt(plan);
      const started = performance.now();
      session = await createOrtSession(ort, new Uint8Array(message.model as ArrayBuffer), ortOptions(plan));
      scope.postMessage({ type: 'ready', loadMs: performance.now() - started });
    } else if (message.type === 'look') {
      if (!ort || !session) throw new Error('The subject detector is not ready.');
      const tile = message.tile as Box;
      const scale = tileScale(tile);
      const w = Math.max(1, Math.round(tile.w * scale)), h = Math.max(1, Math.round(tile.h * scale));
      const input = toInput(pixelsOf(message.picture as ImageBitmap, tile, w, h), w, h);
      const size = DETECTOR_MODEL.inputSize;
      const started = performance.now();
      const results = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]) });
      const data = results[session.outputNames[0]]?.data;
      if (!(data instanceof Float32Array)) throw new Error('The subject detector returned an unexpected result.');
      scope.postMessage({ type: 'found', id: message.id, detections: decodeTile(data, tile), runMs: performance.now() - started });
    } else if (message.type === 'sharpness') {
      const picture = message.picture as ImageBitmap;
      const crop = sharpnessCrop(picture.width, picture.height, message.box as Box);
      scope.postMessage({ type: 'sharp', id: message.id, sharpness: boxSharpness(pixelsOf(picture, crop.region, crop.width, crop.height), crop.width, crop.height) });
    } else if (message.type === 'run') {
      if (!ort || !session) throw new Error('The subject detector is not ready.');
      const size: number = message.size;
      const started = performance.now();
      const results = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', message.input as Float32Array, [1, 3, size, size]) });
      const data = results[session.outputNames[0]]?.data;
      if (!(data instanceof Float32Array)) throw new Error('The subject detector returned an unexpected result.');
      const copy = new Float32Array(data); // Detach from the runtime's own memory before handing it over.
      scope.postMessage({ type: 'result', id: message.id, data: copy, runMs: performance.now() - started }, [copy.buffer]);
    }
  } catch (problem) {
    scope.postMessage({ type: 'error', id: message.id, message: problem instanceof Error ? problem.message : String(problem) });
  }
};
