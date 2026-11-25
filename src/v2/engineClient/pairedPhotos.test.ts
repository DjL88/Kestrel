import test from 'node:test';
import assert from 'node:assert/strict';
import { recountBursts } from './pairedPhotos';
import type { Photo } from '../ui/contract';

const p = (id: string, index: number, count: number) => ({ id, burst: { groupId: 'g', index, count, ungrouped: false } }) as unknown as Photo;

test('a burst that only held a RAW and its folded JPEG is no burst', () => {
  const [only] = recountBursts([p('raw', 1, 2)]);
  assert.equal(only.burst, undefined);
});

test('a real burst is recounted over the photos shown', () => {
  const out = recountBursts([p('a', 1, 4), p('c', 3, 4)]);
  assert.deepEqual(out.map((photo) => [photo.burst?.index, photo.burst?.count]), [[1, 2], [2, 2]]);
});
