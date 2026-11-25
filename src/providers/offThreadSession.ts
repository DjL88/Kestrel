import { recordModelLoad, recordModelRun } from '../core/modelStats';
import { createTimedSession } from './modelTiming';
import { readModelReady, readModelResult, type ModelInput, type ModelTensor } from '../core/modelSessionProtocol';

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
}

const copyOf = (data: Float32Array | BigInt64Array) => (data instanceof BigInt64Array ? new BigInt64Array(data) : new Float32Array(data));

const defaultWorker = () => new Worker(new URL('./modelSessionWorker.ts', import.meta.url), { type: 'module' });

export async function createOffThreadSession(id: string, bytes: Uint8Array, options: OffThreadOptions = {}): Promise<OffThreadSession> {
  const startWorker = options.startWorker === undefined ? (typeof Worker === 'undefined' ? null : defaultWorker) : options.startWorker;
  if (startWorker) {
    try {
      return await inWorker(id, bytes, startWorker, options.onLost, options.outputs);
    } catch (problem) {
      console.warn(`The ${id} model could not start in the background; running it here instead.`, problem);
    }
  }
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
  worker.postMessage({ type: 'init', model: copy.buffer }, [copy.buffer]);
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
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const session = await createTimedSession(ort, id, bytes, { executionProviders: ['wasm'] });
  return {
    inputNames: session.inputNames,
    outputNames: session.outputNames,
    where: 'main',
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
