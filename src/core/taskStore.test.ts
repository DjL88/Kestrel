import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskStore } from './taskStore.ts';

test('a task shows progress and finishes', () => {
  const store = createTaskStore(() => 100);
  const task = store.start('Exporting 3 photos', { total: 3 });
  task.progress(2, undefined, 'bird-2.jpg');
  assert.deepEqual(store.list().map((t) => [t.title, t.state, t.done, t.total, t.detail]), [['Exporting 3 photos', 'running', 2, 3, 'bird-2.jpg']]);
  task.finish();
  assert.equal(store.list()[0].state, 'done');
});

test('cancelling stops the job, marks it cancelled, and the job can tell', () => {
  const store = createTaskStore();
  let aborted = false;
  const task = store.start('Auto-cull', { cancel: () => { aborted = true; } });
  assert.equal(task.cancelled, false);
  assert.equal(store.cancel(task.id), true);
  assert.equal(aborted, true);
  assert.equal(task.cancelled, true);
  assert.equal(store.list()[0].state, 'cancelled');
  task.finish();
  task.fail('too late');
  assert.equal(store.list()[0].state, 'cancelled', 'a cancelled task stays cancelled');
});

test('a task that cannot be cancelled says so, and a finished one cannot be cancelled', () => {
  const store = createTaskStore();
  const fixed = store.start('Saving');
  assert.equal(store.cancel(fixed.id), false);
  const done = store.start('Export', { cancel: () => {} });
  done.finish();
  assert.equal(store.cancel(done.id), false);
});

test('a failed task keeps its message', () => {
  const store = createTaskStore();
  store.start('Export', { cancel: () => {} }).fail('Reconnect photo.jpg to export it.');
  assert.deepEqual([store.list()[0].state, store.list()[0].detail], ['failed', 'Reconnect photo.jpg to export it.']);
});

test('only the last few finished tasks are kept, and running ones never are dropped', () => {
  const store = createTaskStore();
  const running = store.start('Long job', { cancel: () => {} });
  for (let i = 0; i < 9; i += 1) store.start(`Job ${i}`).finish();
  assert.equal(store.list().filter((t) => t.state === 'done').length, 5);
  assert.equal(store.list().find((t) => t.id === running.id)?.state, 'running');
  store.clearFinished();
  assert.deepEqual(store.list().map((t) => t.id), [running.id]);
});

test('listeners hear about changes and can stop listening', () => {
  const store = createTaskStore();
  let heard = 0;
  const stop = store.subscribe(() => { heard += 1; });
  const task = store.start('x');
  task.progress(1);
  assert.equal(heard, 2);
  stop();
  task.finish();
  assert.equal(heard, 2);
});
