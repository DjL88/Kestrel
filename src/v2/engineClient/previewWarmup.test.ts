import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoFrame } from '../../core/types';
import { CULL_WARMUP_PREVIEW_KEY, cullWarmupPreviewOn, warmupNeighbours } from './previewWarmup.ts';

const frame = (id: string, extra: Partial<PhotoFrame> = {}) => ({ id, stableKey: `k-${id}`, filename: `${id}.nef`, ...extra }) as PhotoFrame;

test('the read-ahead is off unless this device or an admin turns it on', () => {
  assert.equal(cullWarmupPreviewOn(null), false);
  assert.equal(cullWarmupPreviewOn({ getItem: () => null }), false);
  assert.equal(cullWarmupPreviewOn({ getItem: (key) => (key === CULL_WARMUP_PREVIEW_KEY ? '1' : null) }), true);
  assert.equal(cullWarmupPreviewOn({ getItem: () => { throw new Error('blocked'); } }), false);
});

test('neighbours come nearest first, next before previous, and skip removed and demo photos', () => {
  const frames = [frame('a'), frame('b', { removedAt: 1 } as Partial<PhotoFrame>), frame('c'), frame('d'), frame('e', { isDemo: true }), frame('f'), frame('g')];
  assert.deepEqual(warmupNeighbours(frames, 'd').map((f) => f.id), ['c']);
  assert.deepEqual(warmupNeighbours(frames, 'c').map((f) => f.id), ['d', 'a']);
  assert.deepEqual(warmupNeighbours(frames, 'd', 2).map((f) => f.id), ['c', 'f', 'a']);
  assert.deepEqual(warmupNeighbours(frames, 'g').map((f) => f.id), ['f']);
});

test('nothing is prepared without an active photo or a reach', () => {
  const frames = [frame('a'), frame('b')];
  assert.deepEqual(warmupNeighbours(frames, null), []);
  assert.deepEqual(warmupNeighbours(frames, 'missing'), []);
  assert.deepEqual(warmupNeighbours(frames, 'a', 0), []);
});
