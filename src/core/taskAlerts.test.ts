import test from 'node:test';
import assert from 'node:assert/strict';
import { alertText, alreadyFinished, groupAlerts, newlyFinished, releaseHeld } from './taskAlerts';
import { createTaskStore, type Task } from './taskStore';

const task = (id: number, state: Task['state'], startedAt: number, endedAt: number | undefined, title = `Task ${id}`): Task =>
  ({ id, title, state, done: 0, total: null, startedAt, updatedAt: endedAt ?? startedAt, ...(endedAt !== undefined ? { endedAt } : {}) });
const words = {
  oneDone: (t: string) => `${t} finished.`, oneFailed: (t: string) => `${t} needs attention.`,
  manyDone: (n: number) => `${n} tasks finished.`, manyWithFailures: (n: number, f: number) => `${n} tasks ended, ${f} need attention.`,
};

test('only long work is told; quick and cancelled work is not; each task is told once', () => {
  const seen = new Set<number>();
  const list = [task(1, 'done', 0, 5_000), task(2, 'done', 0, 30_000), task(3, 'cancelled', 0, 60_000), task(4, 'failed', 0, 1_000), task(5, 'running', 0, undefined)];
  assert.deepEqual(newlyFinished(list, seen).map((t) => t.id), [4, 2], 'a failure is always told, even a quick one');
  assert.deepEqual(newlyFinished(list, seen), [], 'never twice');
});

test('watching starts quiet: work that ended before is never told', () => {
  const list = [task(1, 'done', 0, 90_000), task(2, 'running', 0, undefined)];
  const seen = alreadyFinished(list);
  assert.deepEqual(newlyFinished(list, seen), []);
  assert.deepEqual(newlyFinished([...list.slice(0, 1), task(2, 'done', 0, 100_000)], seen).map((t) => t.id), [2]);
});

test('tasks ending close together become one alert, never one per photo', () => {
  const seen = new Set<number>();
  const finished = newlyFinished([task(1, 'done', 0, 30_000, 'Export 48 photos'), task(2, 'done', 0, 31_000), task(3, 'failed', 0, 33_000), task(4, 'done', 0, 90_000)], seen);
  const alerts = groupAlerts(finished);
  assert.equal(alerts.length, 2);
  assert.equal(alertText(alerts[0], words), '3 tasks ended, 1 need attention.');
  assert.equal(alertText(alerts[1], words), 'Task 4 finished.');
  assert.equal(alertText(groupAlerts(finished.slice(0, 1))[0], words), 'Export 48 photos finished.');
});

test('alerts held while the window is in the background are told once, together, on return', () => {
  const finished = newlyFinished([task(1, 'done', 0, 30_000), task(2, 'done', 0, 300_000)], new Set());
  const held = groupAlerts(finished);
  assert.equal(held.length, 2);
  assert.deepEqual(releaseHeld(held, false), { show: null, keep: held });
  const { show, keep } = releaseHeld(held, true);
  assert.deepEqual(keep, []);
  assert.equal(alertText(show!, words), '2 tasks finished.');
});

test('works with the real task store', () => {
  let now = 1_000;
  const store = createTaskStore(() => now);
  const seen = alreadyFinished(store.list());
  const export1 = store.start('Export 12 photos');
  now += 25_000;
  export1.finish('Saved 12 photos');
  const quick = store.start('Thumbnail');
  now += 100;
  quick.finish();
  const told = newlyFinished(store.list(), seen);
  assert.deepEqual(told.map((t) => [t.title, t.detail]), [['Export 12 photos', 'Saved 12 photos']]);
});
