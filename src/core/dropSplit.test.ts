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
