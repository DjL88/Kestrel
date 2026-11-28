import assert from 'node:assert/strict';
import test from 'node:test';
import { createFinishBatchStore } from './finishBatchStore';
import type { FinishResult } from './runFinishBatch';

const result = (photoId: string, state: FinishResult['state'] = 'applied'): FinishResult =>
  ({ photoId, filename: `${photoId}.jpg`, state, why: 'why', denoised: false, review: 'pending', at: 1 });

test('a batch is recorded in plan order and finishes once', () => {
  const store = createFinishBatchStore();
  let calls = 0;
  const off = store.subscribe(() => { calls += 1; });
  const run = store.begin('p', 2);
  store.add(run, result('a'));
  store.add(run, result('b', 'held'));
  store.finish(run, false);
  store.finish(run, true);
  const now = store.getSnapshot();
  assert.deepEqual(now.results.map((r) => r.photoId), ['a', 'b']);
  assert.equal(now.phase, 'done');
  assert.equal(now.stopped, false, 'a finished batch is not reopened');
  assert.equal(calls, 4);
  off();
});

test('Approve all keeps only the applied edits still waiting, and never touches held photos or undone ones', () => {
  const store = createFinishBatchStore();
  const run = store.begin('p', 4);
  store.add(run, result('a')); store.add(run, result('b')); store.add(run, result('c', 'held')); store.add(run, result('d'));
  store.mark('b', { review: 'undone' });
  store.keepAll();
  assert.deepEqual(store.getSnapshot().results.map((r) => r.review), ['kept', 'undone', 'pending', 'kept']);
});

test('reset forgets the batch', () => {
  const store = createFinishBatchStore();
  store.begin('p', 1);
  store.reset();
  assert.equal(store.getSnapshot().phase, 'idle');
});


test('late results and completion from a cancelled batch cannot affect a new project or a new run of the same project', () => {
  const store = createFinishBatchStore();
  const old = store.begin('first', 2);
  store.reset();
  store.add(old, result('late'));
  store.finish(old, true);
  assert.equal(store.getSnapshot().phase, 'idle');
  assert.deepEqual(store.getSnapshot().results, []);
  const other = store.begin('second', 1);
  assert.equal(store.isCurrent(old), false);
  store.add(old, result('wrong'));
  store.finish(old, true);
  assert.equal(store.getSnapshot().phase, 'running');
  assert.deepEqual(store.getSnapshot().results, []);
  store.add(other, result('right'));
  store.finish(other, false);
  store.add(other, result('late-after-finish'));
  assert.deepEqual(store.getSnapshot().results.map(r => r.photoId), ['right']);
  const retry = store.begin('second', 1);
  store.add(other, result('wrong-again'));
  store.finish(other, true);
  assert.equal(store.isCurrent(retry), true);
  assert.equal(store.getSnapshot().phase, 'running');
  assert.deepEqual(store.getSnapshot().results, []);
});
