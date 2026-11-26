import test from 'node:test';
import assert from 'node:assert/strict';
import { filmstripActivity } from './edgeActivity.ts';
import type { TaskInfo } from '../contract.ts';

const task = (change: Partial<TaskInfo>): TaskInfo => ({ id: '1', label: 'Importing photos', detail: '', progress: 0, status: 'running', ...change });

test('no import or sorting work: no filmstrip bar', () => {
  assert.equal(filmstripActivity([]), null);
  assert.equal(filmstripActivity([task({ kind: 'export', total: 4, done: 1 })]), null);
  assert.equal(filmstripActivity([task({ kind: 'import', status: 'done', total: 4, done: 4 })]), null);
  assert.equal(filmstripActivity([task({ status: 'running' })]), null, 'work of no known kind is not claimed');
});

test('an import shows its real share done, with its own words', () => {
  assert.deepEqual(filmstripActivity([task({ kind: 'import', total: 40, done: 10, detail: '10 of 40' })]),
    { label: 'Importing photos: 10 of 40', value: 25 });
});

test('import and Auto-pilot cull together count as one bar; queued work keeps it on', () => {
  const bar = filmstripActivity([
    task({ id: 'a', kind: 'import', total: 10, done: 10, status: 'running' }),
    task({ id: 'b', kind: 'cull', label: 'Sorting photos', total: 10, done: 0, status: 'queued' }),
  ]);
  assert.equal(bar?.value, 50);
  assert.equal(bar?.label, 'Importing photos');
});

test('an unknown amount is indeterminate, never a guessed number', () => {
  assert.equal(filmstripActivity([task({ kind: 'cull', total: null })])?.value, null);
});
