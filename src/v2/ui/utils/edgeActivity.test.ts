import test from 'node:test';
import assert from 'node:assert/strict';
import { filmstripActivity, minutesLeft, roughRemainingMs, tasksWheelProgress } from './edgeActivity.ts';
import type { TaskInfo } from '../contract.ts';

const task = (change: Partial<TaskInfo>): TaskInfo => ({ id: '1', label: 'Importing photos', detail: '', progress: 0, status: 'running', ...change });

test('no import or sorting work: no filmstrip bar', () => {
  assert.equal(filmstripActivity([]), null);
  assert.equal(filmstripActivity([task({ kind: 'export', total: 4, done: 1 })]), null);
  assert.equal(filmstripActivity([task({ kind: 'import', status: 'done', total: 4, done: 4 })]), null);
  assert.equal(filmstripActivity([task({ status: 'running' })]), null, 'work of no known kind is not claimed');
});

test('an import shows its real count and share done', () => {
  const bar = filmstripActivity([task({ kind: 'import', total: 40, done: 10 })], 0);
  assert.equal(bar?.value, 25);
  assert.equal(bar?.done, 10);
  assert.equal(bar?.total, 40);
  assert.equal(bar?.label, 'Importing photos');
});

test('import and Auto-pilot cull together count as one bar; queued work keeps it on', () => {
  const bar = filmstripActivity([
    task({ id: 'a', kind: 'import', total: 10, done: 10, status: 'running' }),
    task({ id: 'b', kind: 'cull', label: 'Sorting photos', total: 10, done: 0, status: 'queued' }),
  ], 0);
  assert.equal(bar?.value, 50);
  assert.equal(bar?.label, 'Importing photos');
});

test('an unknown amount is indeterminate, never a guessed number', () => {
  const bar = filmstripActivity([task({ kind: 'cull', total: null })]);
  assert.equal(bar?.value, null);
  assert.equal(bar?.remainingMs, null);
});

test('time left comes only from measured progress', () => {
  assert.equal(roughRemainingMs(2, 100, 0, 60_000), null, 'too few photos done');
  assert.equal(roughRemainingMs(10, 100, 0, 5_000), null, 'too little time passed');
  assert.equal(roughRemainingMs(10, 100, 0, 60_000), 540_000, '10 a minute, 90 to go: nine minutes');
  assert.equal(roughRemainingMs(100, 100, 0, 60_000), null, 'finished');
  assert.equal(minutesLeft(540_000), 9);
  assert.equal(minutesLeft(30_000), null);
  assert.equal(minutesLeft(null), null);
});

test('the Tasks wheel counts photos, not tasks', () => {
  assert.deepEqual(tasksWheelProgress([]), { running: 0, percent: 0, done: null, total: null });
  assert.deepEqual(tasksWheelProgress([task({ total: 120, done: 34 }), task({ id: '2', total: 10, done: 10, status: 'queued' })]),
    { running: 1, percent: 28, done: 34, total: 120 });
  assert.equal(tasksWheelProgress([task({ total: null, progress: 40 })]).percent, 40);
});

test('the count beside "Adding 2050 photos" is the import own count, never 2,051 with a thumbnail task on top', () => {
  const bar = filmstripActivity([
    task({ id: 'a', kind: 'import', label: 'Adding 2050 photos', total: 2050, done: 2049, status: 'running' }),
    task({ id: 'b', kind: 'thumbnail', label: 'Preparing 1 thumbnail', total: 1, done: 1, status: 'running' }),
  ], 0);
  assert.equal(bar?.label, 'Adding 2050 photos');
  assert.equal(bar?.total, 2050);
  assert.equal(bar?.done, 2049);
});

test('a long time left reads in hours and minutes', async () => {
  const { STRINGS } = await import('../strings.ts');
  assert.equal(STRINGS.activityBar.minutesLeft(9), 'About 9 min left');
  assert.equal(STRINGS.activityBar.minutesLeft(627), 'About 10 h 27 min left');
});
