import type { ComputedObservation } from './cullObservationCompute';
import { deviceMemoryBudget } from './deviceBudget';
import { recordModelLoad, recordModelRun } from '../core/modelStats';

/**
 * A pool of culling workers (src/providers/cullObservationWorker.ts): every core but one, at most 4 on phones, held
 * to the device's memory budget (src/core/memoryBudget.ts). Each job goes to the first free worker; the rest wait in order. A worker that fails
 * to start means no pool at all, and the callers keep today's main-thread path. The pool closes itself after a
 * quiet spell (the budget's idle time) so its detector copies do not hold memory between scans.
 */
export interface CullWorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface CullObservationPool {
  readonly size: number;
  /** Rejects when the worker fails; the caller treats that like any unexpected failure on the main thread. */
  observe(frameId: string, blob: Blob, tryDetector: boolean): Promise<ComputedObservation>;
  close(): void;
}

interface Slot { worker: CullWorkerLike; busy: boolean }
interface Job { frameId: string; blob: Blob; tryDetector: boolean; resolve: (o: ComputedObservation) => void; reject: (e: Error) => void }

export interface PoolOptions {
  size: number;
  /** The checked detector bytes; each worker gets its own copy. Undefined: detail scoring only. */
  model?: ArrayBuffer;
  createWorker: () => CullWorkerLike;
  /** Close after this long with nothing to do. */
  idleMs?: number;
  /** Model id for Settings → Models timings. */
  modelId?: string;
  /** Called once when the pool closes (idle, a dead worker, or close()). */
  onClosed?: () => void;
}

export async function createCullObservationPool(options: PoolOptions): Promise<CullObservationPool> {
  const idleMs = options.idleMs ?? 60_000;
  const modelId = options.modelId ?? 'yolox-tiny';
  const slots: Slot[] = [];
  const queue: Job[] = [];
  const running = new Map<number, { slot: Slot; job: Job }>();
  let nextId = 1;
  let closed = false;
  let idle: ReturnType<typeof setTimeout> | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    if (idle) clearTimeout(idle);
    for (const slot of slots) slot.worker.terminate();
    const stopped = new Error('The culling workers were stopped.');
    for (const { job } of running.values()) job.reject(stopped);
    for (const job of queue.splice(0)) job.reject(stopped);
    running.clear();
    options.onClosed?.();
  };
  const armIdle = () => {
    if (idle) clearTimeout(idle);
    idle = null;
    if (!closed && !running.size && !queue.length) idle = setTimeout(close, idleMs);
  };
  const pump = () => {
    for (const slot of slots) {
      if (slot.busy || !queue.length) continue;
      const job = queue.shift()!;
      const id = nextId++;
      slot.busy = true;
      running.set(id, { slot, job });
      slot.worker.postMessage({ type: 'run', id, frameId: job.frameId, blob: job.blob, tryDetector: job.tryDetector });
    }
    armIdle();
  };

  await Promise.all(Array.from({ length: Math.max(1, options.size) }, () => new Promise<void>((resolve, reject) => {
    const worker = options.createWorker();
    const slot: Slot = { worker, busy: false };
    slots.push(slot);
    worker.onerror = () => {
      reject(new Error('A culling worker failed.'));
      // A worker that dies later takes the pool with it; callers fall back to the main thread.
      if (!closed && slot.busy) close();
    };
    worker.onmessage = (event) => {
      const message = event.data as { type: string; id?: number; loadMs?: number; runMs?: number[]; observation?: ComputedObservation; message?: string };
      if (message.type === 'ready') { if (options.model) recordModelLoad(modelId, message.loadMs ?? 0); resolve(); return; }
      if (message.type === 'error' && message.id === undefined) { reject(new Error(message.message)); return; }
      const entry = message.id === undefined ? undefined : running.get(message.id);
      if (!entry) return;
      running.delete(message.id!);
      slot.busy = false;
      for (const ms of message.runMs ?? []) recordModelRun(modelId, ms);
      if (message.type === 'result' && message.observation) entry.job.resolve(message.observation);
      else entry.job.reject(new Error(message.message ?? 'The photo could not be looked at.'));
      pump();
    };
    worker.postMessage({ type: 'init', model: options.model?.slice(0) }, []);
  }))).catch((problem) => { close(); throw problem; });
  armIdle();

  return {
    size: slots.length,
    observe(frameId, blob, tryDetector) {
      if (closed) return Promise.reject(new Error('The culling workers were stopped.'));
      return new Promise<ComputedObservation>((resolve, reject) => {
        queue.push({ frameId, blob, tryDetector, resolve, reject });
        pump();
      });
    },
    close,
  };
}

/** The app's shared pool, started on first use. Resolves null when workers or the detector cannot start here. */
let shared: Promise<CullObservationPool | null> | null = null;

export function sharedCullObservationPool(): Promise<CullObservationPool | null> {
  shared ??= (async () => {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
    try {
      const { verifiedDetectorModel } = await import('./objectDetector');
      const { bytes } = await verifiedDetectorModel();
      const budget = deviceMemoryBudget(); // workers and idle unloading both come from the device's memory budget
      return await createCullObservationPool({
        size: budget.cullWorkers,
        idleMs: budget.modelIdleUnloadMs,
        model: bytes,
        createWorker: () => new Worker(new URL('./cullObservationWorker.ts', import.meta.url), { type: 'module' }) as unknown as CullWorkerLike,
        onClosed: () => { shared = null; },
      });
    } catch (problem) {
      console.warn('Culling workers could not start; looking at photos on the main thread', problem);
      shared = null; // try again next scan; the main-thread path is used for this one
      return null;
    }
  })();
  return shared;
}
