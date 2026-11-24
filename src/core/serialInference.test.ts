import assert from 'node:assert/strict';
import test from 'node:test';
import { createSerialInferenceQueue } from './serialInference';

test('model checks never overlap even when requests arrive together', async () => {
  const run = createSerialInferenceQueue();
  const order: string[] = [];
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const first = run(async () => { order.push('first-start'); await gate; order.push('first-end'); return 1; });
  const second = run(async () => { order.push('second-start'); return 2; });
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(order, ['first-start']);
  finish();
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second-start']);
});

test('cancelled requests waiting behind a model do not start another model', async () => {
  const run = createSerialInferenceQueue();
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const first = run(async () => { await gate; return 'old'; });
  const controller = new AbortController();
  let called = false;
  const cancelled = run(async () => { called = true; return 'never'; }, controller.signal);
  const rejected = assert.rejects(cancelled, { name: 'AbortError' });
  controller.abort();
  finish();
  assert.equal(await first, 'old');
  await rejected;
  assert.equal(called, false);
  assert.equal(await run(async () => 'recovered'), 'recovered');
});

test('failure of an earlier model does not deadlock the inference queue', async () => {
  const run = createSerialInferenceQueue();
  await assert.rejects(run(async () => { throw new Error('WASM unavailable'); }), /WASM unavailable/);
  assert.equal(await run(async () => 'next photograph'), 'next photograph');
});


test('Stop rejects a waiting caller immediately without releasing the model barrier', async () => {
  const run = createSerialInferenceQueue();
  let finish!: () => void;
  const hold = new Promise<void>(resolve => { finish = resolve; });
  const first = run(async () => { await hold; return 'first'; });
  const controller = new AbortController();
  let started = false;
  const waiting = run(async () => { throw Error('must not start'); }, controller.signal);
  controller.abort();
  try {
    await assert.rejects(waiting, { name: 'AbortError' });
    const third = run(async () => { started = true; return 'third'; });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(started, false);
    finish();
    assert.equal(await third, 'third');
    assert.equal(await first, 'first');
  } finally { finish(); }
});

test('late result from a running model is discarded after Stop', async () => {
  const run = createSerialInferenceQueue();
  const controller = new AbortController();
  const result = run(async () => { controller.abort(); return 'stale'; }, controller.signal);
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(await run(async () => 'next'), 'next');
});
