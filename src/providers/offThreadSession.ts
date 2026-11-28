import { assertModelAllowed } from '../core/featureSwitches';
import { recordModelLoad, recordModelRun } from '../core/modelStats';
import { createTimedSession } from './modelTiming';
import { readModelReady, readModelResult, type ModelInput, type ModelTensor } from '../core/modelSessionProtocol';
import { loadOrt, ortOptions, ortPlanForWorkers } from './ortRuntime';

/**
 * One model session in a worker (src/providers/modelSessionWorker.ts), so inference never holds up the interface: a
 * swipe, tap or slider made while a photo is analysed is handled at once. If a worker cannot be started or the model
 * fails to load there, the same model runs on this thread instead, as before. Load and run times reach Settings →
 * Models either way (src/core/modelStats.ts).
 */
export type { ModelInput, ModelTensor } from '../core/modelSessionProtocol';

export interface OffThreadSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  /** Where it runs, for tests and diagnostics. */
  readonly where: 'worker' | 'main';
  run(feeds: Record<string, ModelInput>): Promise<Record<string, ModelTensor>>;
  /** Let the model go (its worker is ended, so all of its memory comes back). Runs after this are refused. */
  release(): void;
}

export interface OffThreadOptions {
  /** Starts the worker; null runs the model on this thread. */
  startWorker?: (() => Worker) | null;
  /**
   * Called once if the worker stops after loading. The session then refuses every run at once, so the provider should
   * forget it: its next call starts a fresh worker (or falls back to this thread) instead of waiting on a dead one.
   */
  onLost?: () => void;
  /**
   * The outputs the caller reads, when the model has others it does not need (EfficientSAM's decoder also returns a
   * shape). Each named output must be present and float32; others are not checked. Default: every output.
   */
  outputs?: readonly string[];
  /**
   * False for a model too heavy to run on the page at all (it would hold the interface for a minute): when no worker
   * can run it, creating the session fails instead of falling back to this thread. Default true.
   */
  onThisThreadFallback?: boolean;
}

const copyOf = (data: Float32Array | BigInt64Array) => (data instanceof BigInt64Array ? new BigInt64Array(data) : new Float32Array(data));

const defaultWorker = () => new Worker(new URL('./modelSessionWorker.ts', import.meta.url), { type: 'module' });

export async function createOffThreadSession(id: string, bytes: Uint8Array, options: OffThreadOptions = {}): Promise<OffThreadSession> {
  // The owner can switch a model off (src/core/featureSwitches.ts): it is then never started, and callers fall back as for any failed load.
  assertModelAllowed(id);
  const startWorker = options.startWorker === undefined ? (typeof Worker === 'undefined' ? null : defaultWorker) : options.startWorker;
  if (startWorker) {
    try {
      return await inWorker(id, bytes, startWorker, options.onLost, options.outputs);
    } catch (problem) {
      if (options.onThisThreadFallback === false) throw problem;
      console.warn(`The ${id} model could not start in the background; running it here instead.`, problem);
    }
  }
  if (options.onThisThreadFallback === false) throw new Error(`The ${id} model can only run in the background, and that is not possible here.`);
  return onThisThread(id, bytes);
}

async function inWorker(id: string, bytes: Uint8Array, startWorker: () => Worker, onLost?: () => void, wanted?: readonly string[]): Promise<OffThreadSession> {
  const worker = startWorker();
  const pending = new Map<number, { resolve: (outputs: Record<string, ModelTensor>) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let outputNames: readonly string[] = [];
  let lost: Error | null = null;
  let loaded = false;
  const lose = (error: Error) => {
    if (lost) return;
    lost = error;
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
    worker.terminate();
    if (loaded) onLost?.();
  };
  const ready = new Promise<{ inputNames: string[]; outputNames: string[] }>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as { type?: unknown; id?: unknown };
      if (!loaded) {
        try {
          const description = readModelReady(message);
          if (description.loadMs !== null) recordModelLoad(id, description.loadMs);
          loaded = true;
          resolve(description);
        } catch (problem) { reject(problem); }
        return;
      }
      const waiting = typeof message?.id === 'number' ? pending.get(message.id) : undefined;
      if (!waiting) return;
      pending.delete(message.id as number);
      try {
        const { outputs, runMs } = readModelResult(message, outputNames);
        if (runMs !== null) recordModelRun(id, runMs);
        waiting.resolve(outputs);
      } catch (problem) {
        waiting.reject(problem instanceof Error ? problem : new Error(String(problem)));
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || `The ${id} model stopped unexpectedly.`);
      if (!loaded) reject(error);
      lose(error);
    };
  });
  // A copy goes to the worker, so the caller's bytes stay usable.
  const copy = bytes.slice();
  // Two of these workers can run at once (subject outline and photo similarity), so each gets half the spare cores.
  worker.postMessage({ type: 'init', model: copy.buffer, ort: ortPlanForWorkers(2) }, [copy.buffer]);
  let names: { inputNames: string[]; outputNames: string[] };
  try {
    names = await ready;
  } catch (problem) {
    worker.terminate();
    throw problem;
  }
  outputNames = wanted ?? names.outputNames;
  return {
    ...names,
    where: 'worker',
    release: () => {
      if (lost) return;
      // Ended on purpose: callers waiting are told, and onLost is not called (nothing went wrong).
      loaded = false;
      lose(new Error(`The ${id} model was let go.`));
    },
    run: (feeds) => new Promise((resolve, reject) => {
      if (lost) { reject(lost); return; }
      const runId = nextId++;
      pending.set(runId, { resolve, reject });
      // Copies, so the caller's arrays stay usable; the copies move to the worker without another copy.
      const sent: Record<string, { data: Float32Array | BigInt64Array; dims: number[] }> = {};
      const transfer: ArrayBuffer[] = [];
      for (const [name, tensor] of Object.entries(feeds)) {
        const data = copyOf(tensor.data);
        sent[name] = { data, dims: [...tensor.dims] };
        transfer.push(data.buffer);
      }
      worker.postMessage({ type: 'run', id: runId, feeds: sent }, transfer);
    }),
  };
}

async function onThisThread(id: string, bytes: Uint8Array): Promise<OffThreadSession> {
  const ort = await loadOrt();
  const session = await createTimedSession(ort, id, bytes, ortOptions());
  return {
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    where: 'main',
    release: () => { void session.release().catch(() => undefined); },
    run: async (feeds) => {
      const tensors: Record<string, import('onnxruntime-web/wasm').Tensor> = {};
      for (const [name, tensor] of Object.entries(feeds)) {
        tensors[name] = tensor.data instanceof BigInt64Array ? new ort.Tensor('int64', tensor.data, [...tensor.dims]) : new ort.Tensor('float32', tensor.data, [...tensor.dims]);
      }
      const results = await session.run(tensors);
      const outputs: Record<string, ModelTensor> = {};
      // Only float32 outputs, on purpose: the models read here answer in float32 (src/core/modelSessionProtocol.ts).
      for (const [name, tensor] of Object.entries(results)) if (tensor.data instanceof Float32Array) outputs[name] = { data: tensor.data, dims: tensor.dims };
      return outputs;
    },
  };
}
