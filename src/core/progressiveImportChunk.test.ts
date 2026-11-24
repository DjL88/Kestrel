import assert from 'node:assert/strict';
import test from 'node:test';
import { completeImportChunk } from './progressiveImportChunk';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('a ready photo is delivered without waiting for the slowest NEF in its chunk', async () => {
  const slow = deferred<string | null>();
  const middle = deferred<string | null>();
  const fast = deferred<string | null>();
  const seen: string[] = [];
  const work = completeImportChunk(['p1', 'p2', 'p3'], (_value, i) =>
    [slow.promise, middle.promise, fast.promise][i], (frame) => seen.push(frame));
  fast.resolve('ready-p3');
  await Promise.resolve();
  assert.deepEqual(seen, ['ready-p3']);
  middle.resolve('ready-p2');
  await Promise.resolve();
  assert.deepEqual(seen, ['ready-p3', 'ready-p2']);
  slow.resolve('ready-p1');
  assert.deepEqual(await work, ['ready-p1', 'ready-p2', 'ready-p3'],
    'final catalogue order must remain original');
});

test('unreadable photos are kept as null slots and never advertised as ready', async () => {
  const seen: number[] = [];
  const values = await completeImportChunk([10, 20, 30],
    async (value) => value === 20 ? null : value, (value) => seen.push(value));
  assert.deepEqual(values, [10, null, 30]);
  assert.deepEqual(seen, [10, 30]);
});

test('watched imports can remain atomic by omitting the ready callback', async () => {
  const slow = deferred<number | null>();
  const work = completeImportChunk([1, 2], async (value) =>
    value === 1 ? slow.promise : 2);
  slow.resolve(1);
  assert.deepEqual(await work, [1, 2]);
});

test('a failed worker stops later per-photo announcements', async () => {
  const slow = deferred<string | null>();
  const failure = deferred<string | null>();
  const seen: string[] = [];
  const work = completeImportChunk(['slow', 'fail'], (_value, i) =>
    i ? failure.promise : slow.promise, (photo) => seen.push(photo));
  failure.reject(new Error('source changed'));
  await assert.rejects(work, /source changed/);
  slow.resolve('late-photo');
  await Promise.resolve();
  assert.deepEqual(seen, [], 'late completion after failure cannot enter the displayed project');
});


test('a sibling finishing in the same microtask turn as a failure is not announced', async () => {
  const failed = deferred<string | null>();
  const late = deferred<string | null>();
  const ready: string[] = [];
  const chunk = completeImportChunk(['failed', 'late'], (_entry, i) =>
    i === 0 ? failed.promise : late.promise, photo => ready.push(photo));
  failed.reject(new Error('original was disconnected'));
  late.resolve('must-not-publish');
  await assert.rejects(chunk, /disconnected/);
  assert.deepEqual(ready, []);
});

test('a throwing publication callback closes the gate before another worker can publish', async () => {
  const ready: string[] = [];
  const chunk = completeImportChunk(['first', 'second'], async photo => photo, photo => {
    ready.push(photo);
    throw new Error('project closed');
  });
  await assert.rejects(chunk, /project closed/);
  assert.deepEqual(ready, ['first']);
});
