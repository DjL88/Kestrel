import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskStore, taskHealth, tasksNeedAttention, type Task } from './taskStore.ts';

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

test('a failed export remains discoverable after the success timeout and later successful jobs', () => {
  let time = 0;
  const store = createTaskStore(() => time);
  const exportJob = store.start('Saving wildlife shoot');
  exportJob.progress(2, 20);
  exportJob.fail('Drive disconnected after 2 of 20 files.');
  time = 60_000;
  for (let i = 0; i < 12; i++) store.start(`Later success ${i}`).finish();
  assert.equal(tasksNeedAttention(store.list(), time + 60_000), true);
  const failure = store.list().find(task => task.id === exportJob.id)!;
  assert.equal(failure.detail, 'Drive disconnected after 2 of 20 files.');
  assert.equal(failure.done, 2);
  assert.equal(taskHealth(store.list(), time + 60_000), 'problem');
  store.clearFinished();
  assert.equal(tasksNeedAttention(store.list(), time + 60_000), false);
});

test('both histories are bounded independently and subscribers observe the trimmed result', () => {
  const store = createTaskStore();
  const running = store.start('Active import');
  let observed = 0;
  store.subscribe(() => { observed = store.list().length; });
  for (let i = 0; i < 12; i++) {
    store.start(`Failure ${i}`).fail(`Reason ${i}`);
    store.start(`Success ${i}`).finish();
  }
  assert.equal(store.list().length, 11);
  assert.equal(observed, 11, 'the emitted snapshot already contains the trimmed history');
  assert.equal(store.list().filter(task => task.state === 'failed').length, 5);
  assert.equal(store.list().find(task => task.state === 'failed')!.detail, 'Reason 7');
  assert.equal(store.list().find(task => task.id === running.id)?.state, 'running');
  store.clearFinished();
  assert.equal(store.list().length, 1);
});

test('successful and cancelled jobs fade away while active jobs stay visible', () => {
  const store = createTaskStore(() => 100);
  const completed = store.start('Done'); completed.finish();
  const cancelled = store.start('Stopped', { cancel: () => {} }); store.cancel(cancelled.id);
  assert.equal(tasksNeedAttention(store.list(), 5_000), true);
  assert.equal(tasksNeedAttention(store.list(), 11_000), false);
  store.start('Still working');
  assert.equal(tasksNeedAttention(store.list(), 1_000_000), true);
});

test('a long export failing last is retained even when it started before every other job', () => {
  let time = 0;
  const store = createTaskStore(() => time);
  const slow = store.start('Long background export');
  for (let i = 0; i < 8; i++) {
    time += 100;
    store.start(`Short job ${i}`).fail(`Failure ${i}`);
  }
  time += 100;
  slow.fail('Drive disconnected at the end of the long export.');
  assert.equal(store.list().filter(task => task.state === 'failed').length, 5);
  assert.equal(store.list().some(task => task.id === slow.id), true);
  assert.equal(store.list().some(task => task.detail === 'Failure 3'), false);
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

const run = (over: Partial<Task>): Task => ({ id: 1, title: 't', state: 'running', done: 0, total: null, startedAt: 0, updatedAt: 0, ...over });

test('health: nothing running is idle; normal work is ok', () => {
  assert.equal(taskHealth([], 0), 'idle');
  assert.equal(taskHealth([run({ state: 'done' })], 5000), 'idle');
  assert.equal(taskHealth([run({ done: 5, total: 10, updatedAt: 4000 })], 5000), 'ok');
});

test('health: three tasks at once, or a long wait ahead, is busy', () => {
  assert.equal(taskHealth([run({ id: 1, updatedAt: 1 }), run({ id: 2, updatedAt: 1 }), run({ id: 3, updatedAt: 1 })], 2), 'busy');
  assert.equal(taskHealth([run({ done: 1, total: 1000, startedAt: 0, updatedAt: 9000 })], 10_000), 'busy');
});

test('health: a task that has not moved for 20 seconds is stalled', () => {
  assert.equal(taskHealth([run({ done: 3, total: 10, updatedAt: 0 })], 25_000), 'stalled');
  assert.equal(taskHealth([run({ done: 3, total: 10, updatedAt: 10_000 })], 25_000), 'ok');
});

test('health: a failure is a problem, even with other work running', () => {
  assert.equal(taskHealth([run({ id: 1, state: 'failed' }), run({ id: 2, updatedAt: 1 })], 2), 'problem');
});

test('health: progress keeps a task from being called stalled', () => {
  let time = 0;
  const store = createTaskStore(() => time);
  const task = store.start('Export', { total: 10 });
  time = 30_000;
  assert.equal(taskHealth(store.list(), time), 'stalled');
  task.progress(1);
  // It moved, so it is no longer stuck; one photo in 30 seconds is slow, though, so it reads as busy.
  assert.equal(taskHealth(store.list(), time), 'busy');
  task.progress(9);
  assert.equal(taskHealth(store.list(), time), 'ok');
});
