import { createTimedSession } from './modelTiming';
import { recordModelLoad, recordModelRun } from '../core/modelStats';
import { RFDETR_INPUT_LENGTH, readRfDetrResult } from '../core/rfDetrWorkerProtocol';
import { RFDETR_NANO } from '../core/optionalModels';
import { RFDETR_INPUT, decodeRfDetr, rfDetrInput, tandemDetections, type TandemDetection } from '../core/rfDetr';
import { mergeDetections, tilePlan, type Box, type Detection } from '../core/objectDetection';
import { friendlyToolError } from '../core/toolErrors';
import { downloadOptionalModel, optionalModelStatus, readOptionalModelFile, removeOptionalModel, type OptionalModelStatus } from './optionalModels';
import { loadOrt, ortOptions, ortPlanForWorkers } from './ortRuntime';

/**
 * RF-DETR Nano on this device, as an optional download that runs in tandem with YOLOX-tiny. With the pack missing,
 * not offered, or failing to load, `findSubjectsTandem` returns YOLOX's answer alone, so nothing gets worse.
 * Runs through the same onnxruntime-web WASM runtime as the other models, in a background worker so a cull never
 * freezes the interface (about 3.5 s per 384 px tile in single-thread WASM); on the interface thread only where
 * workers cannot start. No network unless the photographer chooses `downloadRfDetr`.
 */
type Ort = typeof import('onnxruntime-web/wasm');
interface Loaded { ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession }
let loading: Promise<Loaded> | null = null;

export const rfDetrStatus = (): Promise<OptionalModelStatus> => optionalModelStatus(RFDETR_NANO);
export const downloadRfDetr = (onProgress: (fraction: number) => void, signal?: AbortSignal) =>
  downloadOptionalModel(RFDETR_NANO, onProgress, signal);
export async function removeRfDetr(): Promise<void> { loading = null; stopWorker(); await removeOptionalModel(RFDETR_NANO); }

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const bytes = await readOptionalModelFile(RFDETR_NANO, 'model');
    const ort = await loadOrt();
    const session = await createTimedSession(ort, RFDETR_NANO.id, bytes, ortOptions());
    return { ort, session };
  })().catch((error) => {
    loading = null;
    console.warn('RF-DETR failed to load', error);
    throw new Error(friendlyToolError(error, 'RF-DETR subject detector'));
  });
  return loading;
}

/**
 * The background worker, started once with the checked model bytes. Null when workers are not available or the worker
 * failed to start; then the interface-thread session runs instead. Requests queue in order (one model copy).
 */
interface WorkerSlot { worker: Worker; pending: Map<number, { resolve: (out: { logits: Float32Array; boxes: Float32Array }) => void; reject: (error: Error) => void }> }
let workerStart: Promise<WorkerSlot | null> | null = null;
let nextId = 1;

function stopWorker(): void {
  void workerStart?.then((slot) => {
    if (!slot) return;
    for (const job of slot.pending.values()) job.reject(new Error('The second subject finder was removed.'));
    slot.worker.terminate();
  });
  workerStart = null;
}

function startWorker(): Promise<WorkerSlot | null> {
  workerStart ??= (async () => {
    if (typeof Worker === 'undefined') return null;
    const bytes = await readOptionalModelFile(RFDETR_NANO, 'model');
    try {
      const worker = new Worker(new URL('./rfDetrWorker.ts', import.meta.url), { type: 'module' });
      const slot: WorkerSlot = { worker, pending: new Map() };
      await new Promise<void>((resolve, reject) => {
        worker.onerror = () => reject(new Error('worker failed'));
        worker.onmessage = (event: MessageEvent) => {
          const message = event.data;
          if (message.type === 'ready') { recordModelLoad(RFDETR_NANO.id, message.loadMs); resolve(); return; }
          if (message.type === 'error' && message.id === undefined) { reject(new Error(message.message)); return; }
          const job = slot.pending.get(message.id);
          if (!job) return;
          slot.pending.delete(message.id);
          try {
            const out = readRfDetrResult(message);
            if (out.runMs !== null) recordModelRun(RFDETR_NANO.id, out.runMs);
            job.resolve(out);
          } catch (error) { job.reject(error as Error); }
        };
        const copy = bytes.slice().buffer;
        worker.postMessage({ type: 'init', model: copy, ort: ortPlanForWorkers(1) }, [copy]);
      });
      worker.onerror = () => {
        for (const job of slot.pending.values()) job.reject(new Error('The second subject finder stopped.'));
        slot.pending.clear();
        workerStart = null; // the next scan starts a fresh worker
      };
      return slot;
    } catch (problem) {
      console.warn('RF-DETR worker could not start; running on the interface thread', problem);
      return null;
    }
  })().catch((error) => {
    workerStart = null;
    throw error;
  });
  return workerStart;
}

function inferInWorker(slot: WorkerSlot, input: Float32Array): Promise<{ logits: Float32Array; boxes: Float32Array }> {
  if (input.length !== RFDETR_INPUT_LENGTH) return Promise.reject(new Error('Invalid detector input shape'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    slot.pending.set(id, { resolve, reject });
    slot.worker.postMessage({ type: 'run', id, input }, [input.buffer]);
  });
}

type Source = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
const dims = (source: Source) => source instanceof HTMLImageElement ? { w: source.naturalWidth, h: source.naturalHeight } : { w: source.width, h: source.height };

async function lookIn(source: Source, tile: Box): Promise<Detection[]> {
  const canvas = document.createElement('canvas');
  canvas.width = RFDETR_INPUT;
  canvas.height = RFDETR_INPUT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, tile.x, tile.y, tile.w, tile.h, 0, 0, RFDETR_INPUT, RFDETR_INPUT);
  const input = rfDetrInput(context.getImageData(0, 0, RFDETR_INPUT, RFDETR_INPUT).data);
  const slot = await startWorker();
  if (slot) {
    const out = await inferInWorker(slot, input);
    return decodeRfDetr(out.logits, out.boxes, tile);
  }
  const { ort, session } = await load();
  const out = await session.run({ pixel_values: new ort.Tensor('float32', input, [1, 3, RFDETR_INPUT, RFDETR_INPUT]) });
  return decodeRfDetr(out.logits.data as Float32Array, out.pred_boxes.data as Float32Array, tile);
}

/** RF-DETR's own answer over the same whole-photo-then-tiles plan YOLOX uses. Throws when the pack is not usable. */
export async function findSubjectsRfDetr(source: Source, signal?: AbortSignal): Promise<Detection[]> {
  await startWorker(); // throws when the pack is not usable; null (no worker) falls back to the interface thread per tile
  const { w, h } = dims(source);
  if (!(w > 0 && h > 0)) return [];
  const found: Detection[] = [];
  for (const tile of tilePlan(w, h)) {
    signal?.throwIfAborted();
    found.push(...await lookIn(source, tile));
  }
  return mergeDetections(found);
}

/** The same bar YOLOX's subject list uses (0.5), so the two answers are compared like for like. */
export const RFDETR_KEEP_SCORE = 0.5;

/**
 * Both detectors, compared (`tandemDetections`), given YOLOX's own answer for the same photo. RF-DETR runs only when
 * its pack is downloaded; when it is missing or fails, the YOLOX answer comes back unchanged in meaning (no review
 * flags). Every subject is kept separately. objectDetector.ts calls this, so every subject scan gets the tandem.
 */
export async function tandemWithRfDetr(source: Source, yolox: readonly Detection[], signal?: AbortSignal): Promise<TandemDetection[]> {
  let rfdetr: Detection[] | null = null;
  if (await rfDetrStatus().catch(() => 'unavailable') === 'ready') {
    try { rfdetr = (await findSubjectsRfDetr(source, signal)).filter((d) => d.score >= RFDETR_KEEP_SCORE); } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      console.warn('RF-DETR unavailable for this photo; using YOLOX alone', error);
    }
  }
  return tandemDetections(rfdetr, yolox);
}
