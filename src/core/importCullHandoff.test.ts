import test from 'node:test';
import assert from 'node:assert/strict';
import { settleImportObservation } from './importCullHandoff';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('import completion need not await slow ONNX; only the background cull waits', async () => {
  const pending = deferred<{ count: number } | undefined>();
  const abort = new AbortController();
  let finishCalls = 0;
  const preflight = {
    finish() { finishCalls++; return pending.promise; },
    abort() {},
  };
  // Simulate the importer handing the observer to its background worker:
  // handing it off is synchronous and does not depend on the model resolving.
  const onImportFinished = () => preflight;
  const handedOff = onImportFinished();
  assert.strictEqual(handedOff, preflight);
  assert.equal(finishCalls, 0);
  const ready = settleImportObservation(handedOff, abort.signal);
  assert.equal(finishCalls, 1);
  let settled = false;
  void ready.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false, 'only background work waits for observation');
  pending.resolve({ count: 1 });
  assert.deepEqual(await ready, { count: 1 });
});

test('a project switch aborts the imported observer and ignores its late result', async () => {
  const pending = deferred<number | undefined>();
  const controller = new AbortController();
  let cancellations = 0;
  const work = settleImportObservation({
    finish: () => pending.promise,
    abort: () => { cancellations++; },
  }, controller.signal);
  controller.abort();
  pending.resolve(5);
  assert.equal(await work, undefined);
  assert.ok(cancellations >= 1, 'model observer receives cancellation');
});

test('already aborted work does not start preflight finishing', async () => {
  const controller = new AbortController();
  controller.abort();
  let finished = false;
  let aborted = false;
  const output = await settleImportObservation({
    finish: async () => { finished = true; return 'unsafe'; },
    abort: () => { aborted = true; },
  }, controller.signal);
  assert.equal(output, undefined);
  assert.equal(finished, false);
  assert.equal(aborted, true);
});

test('an optional model failure must not fail the whole import', async () => {
  const preflight = {
    async finish(): Promise<number> { throw new Error('model unavailable'); },
    abort() {},
  };
  assert.equal(await settleImportObservation(preflight, new AbortController().signal), undefined);
  assert.equal(await settleImportObservation(undefined, new AbortController().signal), undefined);
});

test('a completed, healthy observation is usable after safe handoff', async () => {
  const value = { id: 'shoot-a', count: 3 };
  const preflight = { async finish() { return value; }, abort() {} };
  assert.strictEqual(await settleImportObservation(preflight, new AbortController().signal), value);
});
