import test from 'node:test';
import assert from 'node:assert/strict';
import { prioritizePhotoProcessing, spreadPhotoOrder } from './photoProcessingOrder';
import type { PhotoFrame } from './types';

function photo(index: number, overrides: Partial<PhotoFrame> = {}): PhotoFrame {
  return {
    id: `photo-${index}`, stableKey: `key-${index}`, filename: `photo-${index}.nef`,
    sequenceIndex: index, decision: 'unreviewed',
    burstGroupId: null, burstIndex: 1, burstCount: 1,
    exif: {}, isDemo: false, sourceKind: 'file', ...overrides,
  };
}

test('one hundred photos begin 1,21,41,61,81 then 2,22,42,62,82', () => {
  const pictures = Array.from({ length: 100 }, (_, i) => i + 1);
  const order = spreadPhotoOrder(pictures);
  assert.deepEqual(order.slice(0, 10), [1, 21, 41, 61, 81, 2, 22, 42, 62, 82]);
  assert.equal(new Set(order).size, 100);
  assert.deepEqual([...order].sort((a, b) => a - b), pictures);
  assert.deepEqual(pictures.slice(0, 5), [1, 2, 3, 4, 5], 'the input order is immutable');
});

test('small and uneven shoots contain every photo once without empty lanes', () => {
  assert.deepEqual(spreadPhotoOrder([]), []);
  assert.deepEqual(spreadPhotoOrder([1]), [1]);
  assert.deepEqual(spreadPhotoOrder([1, 2, 3, 4]), [1, 2, 3, 4]);
  assert.deepEqual(spreadPhotoOrder([1, 2, 3, 4, 5, 6, 7]), [1, 3, 5, 7, 2, 4, 6]);
  assert.deepEqual(spreadPhotoOrder([1, 2, 3, 4, 5], 0), [1, 2, 3, 4, 5]);
});

test('camera stars come before the mixed unmarked shoot, with stronger stars first', () => {
  const shots = Array.from({ length: 100 }, (_, i) => photo(i + 1));
  shots[69] = photo(70, { exif: { rating: 4 } });
  shots[88] = photo(89, { exif: { rating: 5 } });
  const ranked = prioritizePhotoProcessing(shots);
  assert.deepEqual(ranked.slice(0, 2).map((f) => f.sequenceIndex), [89, 70]);
  assert.equal(new Set(ranked.map((f) => f.id)).size, shots.length);
  assert.deepEqual(shots.slice(0, 2).map((f) => f.sequenceIndex), [1, 2], 'source catalogue order is unchanged');
});

test('camera rejects are not considered favourites, and clearing EXIF stars is respected', () => {
  const frames = [
    photo(1, { exif: { rating: 5, rejectedByMetadata: true }, decision: 'reject' }),
    photo(2, { exif: { rating: 5 }, rating: 0 }),
    photo(3, { exif: { rating: 4 } }),
    photo(4, { decision: 'keep' }),
  ];
  const order = prioritizePhotoProcessing(frames);
  assert.deepEqual(order.map((frame) => frame.id), ['photo-3', 'photo-4', 'photo-2', 'photo-1']);
  assert.equal(frames[0].decision, 'reject', 'scheduling must not change metadata or manual decisions');
});

test('mixed existing photo order uses original sequenceIndex as the source, without mutating it', () => {
  const shuffled = [photo(5), photo(1), photo(3), photo(4), photo(2)];
  const next = prioritizePhotoProcessing(shuffled);
  assert.deepEqual(next.map((x) => x.sequenceIndex), [1, 2, 3, 4, 5]);
  assert.deepEqual(shuffled.map((x) => x.sequenceIndex), [5, 1, 3, 4, 2]);
});
