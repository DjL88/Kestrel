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
  store.begin('p', 2);
  store.add(result('a'));
  store.add(result('b', 'held'));
  store.finish(false);
  store.finish(true);
  const now = store.getSnapshot();
  assert.deepEqual(now.results.map((r) => r.photoId), ['a', 'b']);
  assert.equal(now.phase, 'done');
  assert.equal(now.stopped, false, 'a finished batch is not reopened');
  assert.equal(calls, 4);
  off();
});

test('Approve all keeps only the applied edits still waiting, and never touches held photos or undone ones', () => {
  const store = createFinishBatchStore();
  store.begin('p', 4);
  store.add(result('a')); store.add(result('b')); store.add(result('c', 'held')); store.add(result('d'));
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
