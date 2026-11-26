import test from 'node:test';
import assert from 'node:assert/strict';
import { trueDetailJob } from './trueDetailJob.ts';
import type { TaskInfo } from '../contract';

const task = (over: Partial<TaskInfo>): TaskInfo => ({
  id: '1', label: 'TrueDetail', kind: 'denoise', detail: '', progress: 40, status: 'running',
  items: [{ id: 'p1', label: 'a.NEF', state: 'running' }], ...over,
});

test('the running TrueDetail job for this photo is found, with how far it has got', () => {
  assert.deepEqual(trueDetailJob([task({})], 'p1'), { state: 'running', percent: 40 });
  assert.deepEqual(trueDetailJob([task({ status: 'queued', progress: 0 })], 'p1'), { state: 'queued', percent: 0 });
});

test('another photo, another kind of job or a finished job is not this photo\'s TrueDetail', () => {
  assert.equal(trueDetailJob([task({})], 'p2'), null);
  assert.equal(trueDetailJob([task({ kind: 'cull' })], 'p1'), null);
  assert.equal(trueDetailJob([task({ status: 'done', progress: 100 })], 'p1'), null);
  assert.equal(trueDetailJob([], 'p1'), null);
  assert.equal(trueDetailJob([task({})], undefined), null);
});
