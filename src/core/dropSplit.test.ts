import assert from 'node:assert/strict';
import test from 'node:test';
import { splitDropped } from './dropSplit.ts';

const file = (name: string) => ({ name });
const keyOf = (f: { name: string }) => `k-${f.name}`;
const frames = [
  { stableKey: 'k-here.jpg', sourceKind: 'file' },
  { stableKey: 'k-moved.jpg', sourceKind: 'file' },
  { stableKey: 'k-gone.jpg', sourceKind: 'file', removedAt: 1 },
];
const has = (key: string) => key === 'k-here.jpg';

test('a missing original is reconnected, not added again', () => {
  const result = splitDropped([file('moved.jpg')], frames, keyOf, has);
  assert.deepEqual(result.reconnect.map((f) => f.name), ['moved.jpg']);
  assert.deepEqual(result.add, []);
});

test('a photo already present is ignored and a new one is added', () => {
  const result = splitDropped([file('here.jpg'), file('new.jpg')], frames, keyOf, has);
  assert.deepEqual(result.reconnect, []);
  assert.deepEqual(result.add.map((f) => f.name), ['new.jpg']);
  assert.equal(result.ignored, 1);
});

test('a photo that was removed from the library comes back as new', () => {
  assert.deepEqual(splitDropped([file('gone.jpg')], frames, keyOf, has).add.map((f) => f.name), ['gone.jpg']);
});


test('removed originals at zero and later timestamps are reimported, not reconnected', () => {
  const removedFrames = [
    { stableKey: 'k-zero.jpg', sourceKind: 'file', removedAt: 0 },
    { stableKey: 'k-later.jpg', sourceKind: 'file', removedAt: 12 },
    { stableKey: 'k-missing.jpg', sourceKind: 'file' },
  ];
  const before = structuredClone(removedFrames);
  const dropped = [file('zero.jpg'), file('later.jpg'), file('missing.jpg')];
  const result = splitDropped(dropped, removedFrames, keyOf, () => false);
  assert.deepEqual(result.add.map((f) => f.name), ['zero.jpg', 'later.jpg']);
  assert.deepEqual(result.reconnect.map((f) => f.name), ['missing.jpg']);
  assert.equal(result.ignored, 0);
  assert.deepEqual(removedFrames, before, 'classification must not mutate catalogue entries');
});
