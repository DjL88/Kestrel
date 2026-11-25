import assert from 'node:assert/strict';
import test from 'node:test';
import { createOffThreadSession } from './offThreadSession.ts';
import { modelStat } from '../core/modelStats.ts';

/** A stand-in worker that answers like src/providers/modelSessionWorker.ts: doubles every input value. */
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  received: unknown[] = [];
  constructor(private readonly failInit = false, private readonly failRun = false) {}
  postMessage(message: { type: string; id?: number; model?: ArrayBuffer; feeds?: Record<string, { data: Float32Array; dims: number[] }> }) {
    this.received.push(message);
    queueMicrotask(() => {
      if (message.type === 'init') {
        this.onmessage?.({ data: this.failInit ? { type: 'error', message: 'bad model' } : { type: 'ready', loadMs: 12, inputNames: ['input'], outputNames: ['output'] } } as MessageEvent);
      } else if (this.failRun) {
        this.onmessage?.({ data: { type: 'error', id: message.id, message: 'run failed' } } as MessageEvent);
      } else {
        const input = message.feeds!.input;
        this.onmessage?.({ data: { type: 'result', id: message.id, runMs: 34, outputs: { output: { data: input.data.map((v) => v * 2), dims: input.dims } } } } as MessageEvent);
      }
    });
  }
  terminate() { this.terminated = true; }
}

test('a model runs in the worker, and the caller keeps its own bytes and inputs', async () => {
  const worker = new FakeWorker();
  const bytes = new Uint8Array([1, 2, 3]);
  const session = await createOffThreadSession('test-model', bytes, { startWorker: () => worker as unknown as Worker });
  assert.equal(session.where, 'worker');
  assert.deepEqual([...session.inputNames], ['input']);
  assert.equal(bytes.byteLength, 3, 'the model bytes are copied, not moved away from the caller');
  const input = new Float32Array([1, 2, 3, 4]);
  const [a, b] = await Promise.all([
    session.run({ input: { data: input, dims: [1, 4] } }),
    session.run({ input: { data: new Float32Array([5]), dims: [1, 1] } }),
  ]);
  assert.deepEqual([...a.output.data], [2, 4, 6, 8]);
  assert.deepEqual([...b.output.data], [10], 'each answer goes to its own run');
  assert.equal(input.length, 4, 'the input is copied, not moved away from the caller');
  const stat = modelStat('test-model');
  assert.ok(stat, 'load and run times reach Settings → Models');
  assert.equal(stat.loadMs, 12);
  assert.deepEqual(stat.runsMs, [34, 34]);
});

test('a failed run is reported to that run only', async () => {
  const session = await createOffThreadSession('test-run-fail', new Uint8Array([1]), { startWorker: () => new FakeWorker(false, true) as unknown as Worker });
  await assert.rejects(session.run({ input: { data: new Float32Array([1]), dims: [1] } }), /run failed/);
});

test('a model that cannot start in a worker stops that worker and is tried on this thread', async () => {
  const worker = new FakeWorker(true);
  // On this thread the runtime then refuses three bytes that are not a model: the error comes from there, not the worker.
  await assert.rejects(createOffThreadSession('test-init-fail', new Uint8Array([1, 2, 3]), { startWorker: () => worker as unknown as Worker }), (error: Error) => !/bad model/.test(error.message));
  assert.equal(worker.terminated, true);
});

test('a worker that stops after loading refuses every later run at once and tells the provider to start afresh', async () => {
  const worker = new FakeWorker();
  let lost = 0;
  const session = await createOffThreadSession('test-crash', new Uint8Array([1]), { startWorker: () => worker as unknown as Worker, onLost: () => { lost += 1; } });
  // A run that never gets an answer, then the worker dies.
  const original = worker.postMessage.bind(worker);
  worker.postMessage = () => undefined;
  const hanging = session.run({ input: { data: new Float32Array([1]), dims: [1] } });
  worker.onerror?.({ message: 'out of memory' } as ErrorEvent);
  await assert.rejects(hanging, /out of memory/);
  worker.postMessage = original;
  await assert.rejects(session.run({ input: { data: new Float32Array([1]), dims: [1] } }), /out of memory/, 'refused at once, not left waiting');
  assert.equal(lost, 1);
  assert.equal(worker.terminated, true);
});

test('a malformed answer is refused, not passed off as a result', async () => {
  const worker = new FakeWorker();
  const session = await createOffThreadSession('test-malformed', new Uint8Array([1]), { startWorker: () => worker as unknown as Worker });
  worker.postMessage = (message: { type: string; id?: number }) => {
    queueMicrotask(() => worker.onmessage?.({ data: { type: 'result', id: message.id, runMs: 1, outputs: { output: { data: new Float32Array(2), dims: [1, 3] } } } } as MessageEvent));
  };
  await assert.rejects(session.run({ input: { data: new Float32Array([1]), dims: [1] } }), /unexpected result/);
});
