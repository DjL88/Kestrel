import type { Pixels } from '../core/colourCheck';
import type { Mask } from '../core/maskTypes';
import type { PhotoEdit } from '../core/photoEdits';
import type { CourseCorrection } from '../engine/enhancementVerifier';
import { estimateNoiseSigma } from '../core/noiseEstimate';
import { v2Text } from '../i18n/areas/v2';
import {
  openDenoiseSession, type DenoiseJob, type DenoiseSession, type DenoiseWorkerReply, type DenoiseWorkerRequest,
} from '../v2/engineClient/denoiseCompute';

/**
 * Runs denoise's pixel work (`v2/engineClient/denoiseCompute.ts`) in a Web Worker so the editor keeps responding while it
 * works: web, Tauri desktop (its CSP allows `worker-src 'self'`) and the Vite dev server alike. Where a Worker cannot be
 * started, or it stops, the same functions run on this thread instead and `onMainThread` says so, so the person is told.
 * Cancelling stops the worker outright, so a long render does not keep running after Cancel.
 */

/** Shown with the result when the work could not run in the background. */
export const MAIN_THREAD_DENOISE_NOTE = v2Text.enhance.denoiseMainThreadNote;

/** The part of `Worker` used here, so tests can stand in a structured-clone fake. */
export interface DenoiseWorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface AsyncDenoiseSession {
  baseline: Pixels;
  render(edit: Partial<PhotoEdit>, masks: Mask[]): Promise<Pixels>;
  assess(edit: Partial<PhotoEdit>, masks: Mask[]): Promise<CourseCorrection>;
  composedOk(edit: Partial<PhotoEdit>, masks: Mask[]): Promise<boolean>;
  close(): void;
}

export interface DenoiseCompute {
  measureNoise(rgba: Uint8ClampedArray, width: number, height: number): Promise<number | null>;
  open(job: DenoiseJob): Promise<AsyncDenoiseSession>;
  /** True once any of this job's work had to run on the interface thread. */
  readonly onMainThread: boolean;
  dispose(): void;
}

class WorkerUnavailable extends Error {}

function startDenoiseWorker(): DenoiseWorkerLike {
  if (typeof Worker === 'undefined') throw new WorkerUnavailable('Web Workers are not available.');
  return new Worker(new URL('./denoiseWorker.ts', import.meta.url), { type: 'module' }) as unknown as DenoiseWorkerLike;
}

type Pending = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };
/** A request before it is given its id. */
type Outgoing = DenoiseWorkerRequest extends infer R ? R extends DenoiseWorkerRequest ? Omit<R, 'id'> : never : never;
type Candidate = { edit: Partial<PhotoEdit>; masks: Mask[] };

export function createDenoiseCompute(options: { createWorker?: () => DenoiseWorkerLike; signal?: AbortSignal } = {}): DenoiseCompute {
  const createWorker = options.createWorker ?? startDenoiseWorker;
  const signal = options.signal;
  const pending = new Map<number, Pending>();
  let worker: DenoiseWorkerLike | null = null;
  let unavailable = false;
  let onMainThread = false;
  let nextId = 1;
  let nextSession = 1;

  const stop = (reason: unknown) => {
    worker?.terminate();
    worker = null;
    for (const entry of pending.values()) entry.reject(reason);
    pending.clear();
  };
  const onAbort = () => stop(signal!.reason);
  signal?.addEventListener('abort', onAbort, { once: true });

  const ensureWorker = (): DenoiseWorkerLike => {
    if (worker) return worker;
    if (unavailable) throw new WorkerUnavailable('The denoise worker stopped.');
    try {
      worker = createWorker();
    } catch (error) {
      unavailable = true;
      throw error instanceof WorkerUnavailable ? error : new WorkerUnavailable(String(error));
    }
    worker.onmessage = (event) => {
      const reply = event.data as DenoiseWorkerReply;
      const entry = pending.get(reply.id);
      if (!entry) return;
      pending.delete(reply.id);
      if (reply.ok) entry.resolve(reply.value);
      else entry.reject(new Error(reply.message));
    };
    worker.onerror = () => {
      unavailable = true;
      stop(new WorkerUnavailable('The denoise worker stopped.'));
    };
    return worker;
  };

  const call = <T>(request: Outgoing, transfer: Transferable[] = []): Promise<T> => {
    if (signal?.aborted) return Promise.reject(signal.reason);
    let target: DenoiseWorkerLike;
    try { target = ensureWorker(); } catch (error) { return Promise.reject(error); }
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      try { target.postMessage({ ...request, id }, transfer); }
      catch (error) { pending.delete(id); reject(new WorkerUnavailable(String(error))); }
    });
  };

  /** Worker first; on this thread only when the worker cannot run. Real errors and cancels pass through. */
  const offThread = async <T>(request: Outgoing, here: () => T, transfer?: Transferable[]): Promise<T> => {
    try {
      return await call<T>(request, transfer);
    } catch (error) {
      if (!(error instanceof WorkerUnavailable)) throw error;
      signal?.throwIfAborted();
      onMainThread = true;
      return here();
    }
  };

  return {
    get onMainThread() { return onMainThread; },
    measureNoise: (rgba, width, height) => offThread<number | null>({ type: 'noise', rgba, width, height },
      () => estimateNoiseSigma(rgba, width, height)),
    async open(job) {
      const session = nextSession++;
      let local: DenoiseSession | null = null;
      const here = () => (local ??= openDenoiseSession(job));
      const baseline = await offThread<Pixels>({ type: 'open', session, job }, () => here().baseline);
      const ask = <T>(type: 'render' | 'assess' | 'composed', body: Candidate, run: (s: DenoiseSession) => T) =>
        offThread<T>({ type, session, ...body }, () => run(here()));
      return {
        baseline,
        render: (edit, masks) => ask('render', { edit, masks }, s => s.render(edit, masks)),
        assess: (edit, masks) => ask('assess', { edit, masks }, s => s.assess(edit, masks)),
        composedOk: (edit, masks) => ask('composed', { edit, masks }, s => s.composedOk(edit, masks)),
        close() {
          local = null;
          if (worker && !signal?.aborted) void call({ type: 'close', session }).catch(() => undefined);
        },
      };
    },
    dispose() {
      signal?.removeEventListener('abort', onAbort);
      stop(new WorkerUnavailable('The denoise job has finished.'));
    },
  };
}
