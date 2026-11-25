import { recordModelLoad, recordModelRun } from '../core/modelStats';
import { createTimedSession } from './modelTiming';

/**
 * One model session in a worker (src/providers/modelSessionWorker.ts), so inference never holds up the interface: a
 * swipe, tap or slider made while a photo is analysed is handled at once. If a worker cannot be started or the model
 * fails to load there, the same model runs on this thread instead, as before. Load and run times reach Settings →
 * Models either way (src/core/modelStats.ts).
 */
export interface ModelTensor { data: Float32Array; dims: readonly number[] }

export interface OffThreadSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  /** Where it runs, for tests and diagnostics. */
  readonly where: 'worker' | 'main';
  run(feeds: Record<string, ModelTensor>): Promise<Record<string, ModelTensor>>;
}

type WorkerFactory = () => Worker;
const defaultWorker: WorkerFactory = () => new Worker(new URL('./modelSessionWorker.ts', import.meta.url), { type: 'module' });

export async function createOffThreadSession(id: string, bytes: Uint8Array, startWorker: WorkerFactory | null = typeof Worker === 'undefined' ? null : defaultWorker): Promise<OffThreadSession> {
  if (startWorker) {
    try {
      return await inWorker(id, bytes, startWorker);
    } catch (problem) {
      console.warn(`The ${id} model could not start in the background; running it here instead.`, problem);
    }
  }
  return onThisThread(id, bytes);
}

async function inWorker(id: string, bytes: Uint8Array, startWorker: WorkerFactory): Promise<OffThreadSession> {
  const worker = startWorker();
  const pending = new Map<number, { resolve: (outputs: Record<string, ModelTensor>) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  const ready = new Promise<{ inputNames: string[]; outputNames: string[] }>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'ready') {
        recordModelLoad(id, message.loadMs);
        resolve({ inputNames: message.inputNames, outputNames: message.outputNames });
      } else if (message.type === 'result') {
        recordModelRun(id, message.runMs);
        pending.get(message.id)?.resolve(message.outputs);
        pending.delete(message.id);
      } else if (message.type === 'error') {
        const error = new Error(message.message);
        if (message.id === undefined) { reject(error); return; }
        pending.get(message.id)?.reject(error);
        pending.delete(message.id);
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || `The ${id} model stopped unexpectedly.`);
      reject(error);
      for (const waiting of pending.values()) waiting.reject(error);
      pending.clear();
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
  return {
    ...names,
    where: 'worker',
    run: (feeds) => new Promise((resolve, reject) => {
      const runId = nextId++;
      pending.set(runId, { resolve, reject });
      // Copies, so the caller's arrays stay usable; the copies move to the worker without another copy.
      const sent: Record<string, { data: Float32Array; dims: number[] }> = {};
      const transfer: ArrayBuffer[] = [];
      for (const [name, tensor] of Object.entries(feeds)) {
        const data = new Float32Array(tensor.data);
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
      for (const [name, tensor] of Object.entries(feeds)) tensors[name] = new ort.Tensor('float32', tensor.data, [...tensor.dims]);
      const results = await session.run(tensors);
      const outputs: Record<string, ModelTensor> = {};
      for (const [name, tensor] of Object.entries(results)) if (tensor.data instanceof Float32Array) outputs[name] = { data: tensor.data, dims: tensor.dims };
      return outputs;
    },
  };
}
