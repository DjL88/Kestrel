import { sha256Hex } from '../core/sha256';
import { friendlyToolError } from '../core/toolErrors';
import { prefersExperimentalOnly } from '../core/enginePreference';
import { analyzeSubjectKestrel } from '../core/kestrelVision';
import { bundledModelUrl } from './bundledModelAssets';
import { DETECTOR_MODEL, boxSharpness, detectorWorkerCount, decodeTile, mergeDetections, tilePlan, tileScale, toInput, type Box, type Detection } from '../core/objectDetection';

type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded { ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession }
let loading: Promise<Loaded> | null = null;

/** The checked model file, fetched once and shared with every worker. A failure is remembered for the rest of a scan. */
let modelBytes: Promise<ArrayBuffer> | null = null;
function verifiedModel(): Promise<ArrayBuffer> {
  modelBytes ??= (async () => {
    const modelUrl = bundledModelUrl(DETECTOR_MODEL.file);
    if (!modelUrl) throw new Error('The optional subject detector is not installed in this preview. Original photos and manual editing remain available.');
    const response = await fetch(modelUrl);
    if (!response.ok) throw new Error('The subject detector could not be loaded.');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== DETECTOR_MODEL.bytes || (await sha256Hex(bytes)) !== DETECTOR_MODEL.sha256) {
      throw new Error('The subject detector file does not match its checksum, so it was not used.');
    }
    return bytes;
  })();
  return modelBytes;
}

/** Call at the start of a scan: a model that failed earlier gets a fresh try, but never more than one per scan. */
export function resetDetectorFailure(): void {
  if (failed) { pool = null; modelBytes = null; loading = null; failed = false; }
}
let failed = false;

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const bytes = await verifiedModel();
    const ort = await import('onnxruntime-web/wasm').catch(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      return import('onnxruntime-web/wasm');
    });
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ['wasm'] });
    return { ort, session };
  })().catch((error) => {
    failed = true;
    console.warn('Subject detector failed to load', error);
    throw new Error(friendlyToolError(error));
  });
  return loading;
}

/**
 * Background workers that each hold one copy of the model. Several photos can be looked at at once, and the interface
 * thread is never blocked by inference. If workers cannot be started the model runs here instead, as before.
 */
interface Slot { worker: Worker; busy: boolean }
let pool: Promise<Slot[] | null> | null = null;
const waiting: Array<(slot: Slot) => void> = [];
const pending = new Map<number, { resolve: (data: Float32Array) => void; reject: (error: Error) => void }>();
let nextId = 1;

function startPool(): Promise<Slot[] | null> {
  pool ??= (async () => {
    if (typeof Worker === 'undefined') return null;
    let bytes: ArrayBuffer;
    try {
      bytes = await verifiedModel(); // one request, one checksum, whatever the number of workers
    } catch (problem) {
      failed = true;
      throw new Error(friendlyToolError(problem));
    }
    try {
      const slots: Slot[] = [];
      await Promise.all(Array.from({ length: detectorWorkerCount(typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4) }, () => new Promise<void>((resolve, reject) => {
        const worker = new Worker(new URL('./detectorWorker.ts', import.meta.url), { type: 'module' });
        const slot: Slot = { worker, busy: false };
        worker.onerror = () => reject(new Error('worker failed'));
        worker.onmessage = (event: MessageEvent) => {
          const message = event.data;
          if (message.type === 'ready') { slots.push(slot); resolve(); return; }
          if (message.type === 'error' && message.id === undefined) { reject(new Error(message.message)); return; }
          const job = pending.get(message.id);
          if (!job) return;
          pending.delete(message.id);
          const next = waiting.shift();
          slot.busy = Boolean(next); // handed straight to the next waiting job, so two jobs never share a worker by accident
          next?.(slot);
          if (message.type === 'result') job.resolve(message.data as Float32Array); else job.reject(new Error(message.message));
        };
        worker.postMessage({ type: 'init', model: bytes.slice(0) }); // each worker keeps its own copy
      })));
      return slots;
    } catch (problem) {
      console.warn('Detector workers could not start; running on the main thread', problem);
      return null; // the main-thread path reuses the same checked bytes: no second request
    }
  })();
  return pool;
}

/** Number of photos that can be looked at in parallel right now (1 when running on the main thread). */
export async function detectorParallelism(): Promise<number> {
  if (prefersExperimentalOnly() || !bundledModelUrl(DETECTOR_MODEL.file)) return 1;
  return (await startPool().catch(() => null))?.length ?? 1;
}

async function inferInWorker(slots: Slot[], input: Float32Array): Promise<Float32Array> {
  const slot = slots.find((candidate) => !candidate.busy) ?? await new Promise<Slot>((resolve) => waiting.push(resolve));
  slot.busy = true;
  const id = nextId++;
  return new Promise<Float32Array>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    slot.worker.postMessage({ type: 'run', id, input, size: DETECTOR_MODEL.inputSize }, [input.buffer]);
  });
}

type Source = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
const dims = (source: Source) => source instanceof HTMLImageElement ? { w: source.naturalWidth, h: source.naturalHeight } : { w: source.width, h: source.height };

async function lookIn(source: Source, tile: Box): Promise<Detection[]> {
  const scale = tileScale(tile);
  const w = Math.max(1, Math.round(tile.w * scale));
  const h = Math.max(1, Math.round(tile.h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, tile.x, tile.y, tile.w, tile.h, 0, 0, w, h);
  const input = toInput(context.getImageData(0, 0, w, h).data, w, h);
  const slots = await startPool();
  if (slots) return decodeTile(await inferInWorker(slots, input), tile);
  const size = DETECTOR_MODEL.inputSize;
  const loaded = await load();
  const results = await loaded.session.run({ [loaded.session.inputNames[0]]: new loaded.ort.Tensor('float32', input, [1, 3, size, size]) });
  const data = results[loaded.session.outputNames[0]]?.data;
  if (!(data instanceof Float32Array)) throw new Error('The subject detector returned an unexpected result.');
  return decodeTile(data, tile);
}

export interface FoundSubject { detection: Detection; sharpness: number; /** Share of the photo the subject covers. */ coverage: number; engine?: 'onnx-yolox' | 'kestrel-experimental-v1' }

function findSubjectExperimental(source: Source): FoundSubject | null {
  const { w, h } = dims(source);
  if (w < 8 || h < 8) return null;
  const scale = Math.min(1, 240 / Math.max(w, h));
  const cw = Math.max(8, Math.round(w * scale));
  const ch = Math.max(8, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source, 0, 0, cw, ch);
  const pixels = context.getImageData(0, 0, cw, ch).data;
  const analysis = analyzeSubjectKestrel(pixels, cw, ch);
  if (!analysis.box || !analysis.assessment.usable) return null;
  const sx = w / cw;
  const sy = h / ch;
  const x = Math.max(0, Math.min(w - 1, Math.round(analysis.box.x * sx)));
  const y = Math.max(0, Math.min(h - 1, Math.round(analysis.box.y * sy)));
  const box: Box = {
    x,
    y,
    w: Math.max(1, Math.min(w - x, Math.round(analysis.box.w * sx))),
    h: Math.max(1, Math.min(h - y, Math.round(analysis.box.h * sy))),
  };
  return {
    detection: {
      label: analysis.label,
      classId: -1,
      score: analysis.categoryConfidence,
      box,
    },
    sharpness: sharpnessOf(source, box),
    coverage: analysis.coverage,
    engine: 'kestrel-experimental-v1',
  };
}

/**
 * The most likely subject of a photo, and how sharp it is. Uses bundled ONNX detector when present and enabled,
 * automatically falling back to Kestrel's zero-dependency experimental vision engine when offline/unbundled or configured.
 */
export async function findSubject(source: Source, signal?: AbortSignal): Promise<FoundSubject | null> {
  signal?.throwIfAborted();
  if (prefersExperimentalOnly() || !bundledModelUrl(DETECTOR_MODEL.file)) {
    return findSubjectExperimental(source);
  }
  try {
    const { w, h } = dims(source);
    const plan = tilePlan(w, h);
    let detections = await lookIn(source, plan[0]);
    if (!detections.some((d) => d.score >= 0.5)) {
      for (const tile of plan.slice(1)) {
        signal?.throwIfAborted();
        detections = detections.concat(await lookIn(source, tile));
      }
    }
    const best = mergeDetections(detections).sort((a, b) => b.score * Math.sqrt(b.box.w * b.box.h) - a.score * Math.sqrt(a.box.w * a.box.h))[0];
    if (!best) return null;
    return { detection: best, sharpness: sharpnessOf(source, best.box), coverage: (best.box.w * best.box.h) / (w * h), engine: 'onnx-yolox' };
  } catch {
    return findSubjectExperimental(source);
  }
}

/** Sharpness inside the box, measured at a fixed size so a big subject and a small one compare fairly. */
function sharpnessOf(source: Source, box: Box): number {
  const pad = 0.1;
  const { w, h } = dims(source);
  const x = Math.max(0, box.x - box.w * pad);
  const y = Math.max(0, box.y - box.h * pad);
  const cw = Math.min(w - x, box.w * (1 + 2 * pad));
  const ch = Math.min(h - y, box.h * (1 + 2 * pad));
  const scale = Math.min(1, 160 / Math.max(cw, ch));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, Math.round(cw * scale));
  canvas.height = Math.max(4, Math.round(ch * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 0;
  context.drawImage(source, x, y, cw, ch, 0, 0, canvas.width, canvas.height);
  return boxSharpness(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}
