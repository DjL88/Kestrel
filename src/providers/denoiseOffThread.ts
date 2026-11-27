import type { Pixels } from '../core/colourCheck';
import type { Mask } from '../core/maskTypes';
import type { PhotoEdit } from '../core/photoEdits';
import type { CourseCorrection } from '../engine/enhancementVerifier';
import type { LearnedBlend } from '../engine/denoiseAction';
import { estimateNoiseSigma, measureBackgroundNoise, type NoiseMeasurement } from '../core/noiseEstimate';
import { engineText } from '../i18n/areas/engine';
import {
  learnedVerdicts, openDenoiseSession, type DenoiseJob, type DenoiseSession, type DenoiseWorkerReply, type DenoiseWorkerRequest,
} from '../v2/engineClient/denoiseCompute';

/**
 * Runs denoise's pixel work (`v2/engineClient/denoiseCompute.ts`) in a Web Worker so the editor keeps responding while it
 * works: web, Tauri desktop (its CSP allows `worker-src 'self'`) and the Vite dev server alike. Where a Worker cannot be
 * started, or it stops, the job stops with a plain message (never on this thread: that froze the editor for minutes).
 * Cancelling stops the worker outright, so a long render does not keep running after Cancel.
 */

/** Shown with the result when the work could not run in the background. */
export const MAIN_THREAD_DENOISE_NOTE = engineText.denoise.mainThread;

/** The part of `Worker` used here, so tests can stand in a structured-clone fake. */
export interface DenoiseWorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface AsyncDenoiseSession {
  baseline: Pixels;
  render(edit: Partial<PhotoEdit>, masks: Mask[], blend?: LearnedBlend): Promise<Pixels>;
  assess(edit: Partial<PhotoEdit>, masks: Mask[], blend?: LearnedBlend): Promise<CourseCorrection>;
  composedOk(edit: Partial<PhotoEdit>, masks: Mask[], blend?: LearnedBlend): Promise<boolean>;
  close(): void;
}

export interface DenoiseCompute {
  measureNoise(rgba: Uint8ClampedArray, width: number, height: number): Promise<number | null>;
  /** The noise of the flattest background, with the subject (non-zero bytes of `exclude`, one per pixel) left out when it is given. */
  measureBackground(rgba: Uint8ClampedArray, width: number, height: number, exclude?: Uint8Array): Promise<NoiseMeasurement>;
  open(job: DenoiseJob): Promise<AsyncDenoiseSession>;
  /** TrueDetail: which blend strengths of a learned result pass the guardian at full size, on the subject's pixels. */
  qualifyLearned(original: Pixels, learned: Pixels, alpha: Float32Array, strengths: number[]): Promise<Array<{ strength: number; reason: string | null }>>;
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
type Candidate = { edit: Partial<PhotoEdit>; masks: Mask[]; blend?: LearnedBlend };

export function createDenoiseCompute(options: { createWorker?: () => DenoiseWorkerLike; signal?: AbortSignal; runOnPage?: boolean } = {}): DenoiseCompute {
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

  /**
   * In the worker only. Where it cannot run, the job stops with a plain message and nothing changes: the same work on
   * the page froze the editor and Tasks for minutes (owner, 27 Nov). runOnPage exists for tests and is off in the app.
   */
  const offThread = async <T>(request: Outgoing, here: () => T, transfer?: Transferable[]): Promise<T> => {
    try {
      return await call<T>(request, transfer);
    } catch (error) {
      if (!(error instanceof WorkerUnavailable)) throw error;
      signal?.throwIfAborted();
      if (!options.runOnPage) throw new Error(engineText.denoise.workerUnavailable);
      onMainThread = true;
      return here();
    }
  };

  return {
    get onMainThread() { return onMainThread; },
    measureNoise: (rgba, width, height) => offThread<number | null>({ type: 'noise', rgba, width, height },
      () => estimateNoiseSigma(rgba, width, height)),
    measureBackground: (rgba, width, height, exclude) => offThread<NoiseMeasurement>({ type: 'background-noise', rgba, width, height, ...(exclude ? { exclude } : {}) },
      () => measureBackgroundNoise(rgba, width, height, exclude)),
    qualifyLearned: (original, learned, alpha, strengths) => offThread<Array<{ strength: number; reason: string | null }>>(
      { type: 'qualify', original, learned, alpha, strengths }, () => learnedVerdicts(original, learned, alpha, strengths)),
    async open(job) {
      const session = nextSession++;
      let local: DenoiseSession | null = null;
      const here = () => (local ??= openDenoiseSession(job));
      const baseline = await offThread<Pixels>({ type: 'open', session, job }, () => here().baseline);
      const ask = <T>(type: 'render' | 'assess' | 'composed', body: Candidate, run: (s: DenoiseSession) => T) =>
        offThread<T>({ type, session, ...body }, () => run(here()));
      return {
        baseline,
        render: (edit, masks, blend) => ask('render', { edit, masks, blend }, s => s.render(edit, masks, blend)),
        assess: (edit, masks, blend) => ask('assess', { edit, masks, blend }, s => s.assess(edit, masks, blend)),
        composedOk: (edit, masks, blend) => ask('composed', { edit, masks, blend }, s => s.composedOk(edit, masks, blend)),
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
