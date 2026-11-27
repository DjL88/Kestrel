import test from 'node:test';
import assert from 'node:assert/strict';
import { photoJobActive } from './photoJob.ts';
import type { TaskInfo } from '../contract';

const task = (over: Partial<TaskInfo>): TaskInfo => ({ id: '1', label: 'Find the subject', kind: 'mask', detail: '', progress: 0, status: 'running', items: [{ id: 'p1', label: 'a.NEF', state: 'running' }], ...over });

test('a mask job for this photo counts while it waits or runs, and not once it has finished', () => {
  assert.equal(photoJobActive([task({})], 'mask', 'p1'), true);
  assert.equal(photoJobActive([task({ status: 'queued' })], 'mask', 'p1'), true);
  assert.equal(photoJobActive([task({ status: 'done' })], 'mask', 'p1'), false);
  assert.equal(photoJobActive([task({})], 'mask', 'p2'), false);
  assert.equal(photoJobActive([task({ kind: 'denoise' })], 'mask', 'p1'), false);
  assert.equal(photoJobActive([task({})], 'mask', undefined), false);
});
