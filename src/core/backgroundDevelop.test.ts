import { test } from 'node:test';
import assert from 'node:assert/strict';
import { developQueue } from './backgroundDevelop';
import type { PhotoFrame } from './types';

const frame = (n: number, extra: Partial<PhotoFrame> = {}): PhotoFrame => ({
  id: `f${n}`, stableKey: `k${n}`, filename: `DSC_${n}.NEF`, sequenceIndex: n, decision: 'unreviewed', exif: {}, ...extra,
} as unknown as PhotoFrame);

test('only RAW originals still to develop, each once, never removed photos', () => {
  const frames = [frame(1), frame(2, { filename: 'IMG_2.JPG' }), frame(3), frame(4, { removedAt: 5 }), frame(5, { id: 'copy', stableKey: 'k1' }), frame(6)];
  const queue = developQueue(frames, (f) => f.stableKey === 'k6');
  assert.deepEqual(queue.map((f) => f.id), ['f1', 'f3']);
});

test('the photo on screen goes first, then starred photos, then the rest across the shoot', () => {
  const frames = Array.from({ length: 10 }, (_, i) => frame(i + 1, i === 7 ? { rating: 5 } : {}));
  const queue = developQueue(frames, () => false, 'f4');
  assert.equal(queue[0].id, 'f4');
  assert.equal(queue[1].id, 'f8');
  assert.equal(new Set(queue.map((f) => f.id)).size, 10);
});

