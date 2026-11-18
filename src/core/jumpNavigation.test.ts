import assert from 'node:assert/strict';
import test from 'node:test';
import { jumpTarget } from './jumpNavigation';
import type { PhotoFrame } from './types';

function photo(id: string, sequenceIndex: number, capturedAtMs?: number): PhotoFrame {
  return {
    id, stableKey: id, filename: id + '.jpg', sequenceIndex, decision: 'unreviewed',
    exif: capturedAtMs === undefined ? {} : { capturedAtMs },
    sourceKind: 'file', isDemo: false, burstGroupId: null, burstIndex: 1, burstCount: 1,
  };
}

test('jump to beginning and end of a 1695-photo virtual catalogue needs no image loads', () => {
  const frames = Array.from({ length: 1695 }, (_, i) => photo('photo-' + (i + 1), i + 1));
  assert.equal(jumpTarget(frames, { kind: 'first' })?.id, 'photo-1');
  assert.equal(jumpTarget(frames, { kind: 'last' })?.id, 'photo-1695');
  assert.equal(jumpTarget(frames, { kind: 'frame', number: 1200 })?.id, 'photo-1200');
});

test('frame jump uses displayed catalogue sequence, not array index', () => {
  const frames = [photo('last', 1695), photo('first', 1)];
  assert.equal(jumpTarget(frames, { kind: 'frame', number: 1 })?.id, 'first');
  assert.equal(jumpTarget(frames, { kind: 'frame', number: 2 }), null);
});

test('capture-time jump goes to closest available EXIF timestamp', () => {
  const frames = [photo('no-exif', 1), photo('earlier', 2, 10000), photo('later', 3, 20000)];
  assert.equal(jumpTarget(frames, { kind: 'captured-at', timestamp: 19500 })?.id, 'later');
  assert.equal(jumpTarget(frames, { kind: 'captured-at', timestamp: 12000 })?.id, 'earlier');
  assert.equal(jumpTarget([photo('none', 1)], { kind: 'captured-at', timestamp: 12000 }), null);
});

test('last edited uses actual history timestamps, not capture or import time', () => {
  const a = { ...photo('old', 1, 10000), editHistory: { cursor: 1, steps: [{
    kind: 'tone' as const, before: {}, after: {}, at: 30000,
  }] } };
  const b = { ...photo('new', 2, 5000), editHistory: { cursor: 1, steps: [{
    kind: 'crop' as const, before: {}, after: {}, at: 60000,
  }] } };
  assert.equal(jumpTarget([b, a], { kind: 'last-edited' })?.id, 'new');
  assert.equal(jumpTarget([photo('unused', 1)], { kind: 'last-edited' }), null);
});

test('invalid jump requests fail safely', () => {
  const frames = [photo('one', 1)];
  assert.equal(jumpTarget([], { kind: 'last' }), null);
  assert.equal(jumpTarget(frames, { kind: 'frame', number: NaN }), null);
  assert.equal(jumpTarget(frames, { kind: 'captured-at', timestamp: Infinity }), null);
});
