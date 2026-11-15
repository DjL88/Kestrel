import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateAnchorKeys } from './duplicateAnchors';
import type { PhotoFrame } from './types';

const photo = (id: string, decision: PhotoFrame['decision'], patch: Partial<PhotoFrame> = {}): PhotoFrame =>
  ({ id, stableKey: id, filename: id + '.NEF', sequenceIndex: 1, decision,
    burstGroupId: null, burstIndex: 1, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file', ...patch });

test('only an existing kept original with a matching byte size can anchor duplicate rejection', () => {
  const frames = [
    photo('keeper', 'keep'),
    photo('rejected', 'reject'),
    photo('pending', 'unreviewed'),
    photo('removed', 'keep', { removedAt: 1 }),
    photo('demo', 'keep', { isDemo: true }),
    photo('virtual', 'keep', { virtualCopy: { originalFrameId: 'keeper', number: 1 } }),
    photo('otherSize', 'keep'),
    photo('keeperAgain', 'keep', { stableKey: 'keeper' }),
  ];
  const sizes = new Map(frames.map((frame) => [frame.stableKey, frame.stableKey === 'otherSize' ? 100 : 500]));
  assert.deepEqual(duplicateAnchorKeys(frames, new Set([500]), (key) => sizes.get(key)), ['keeper']);
});

test('never hashes a missing or oversized source or a previously rejected only copy', () => {
  const frames = [photo('missing', 'keep'), photo('huge', 'keep'), photo('rejected', 'reject')];
  const sizes = new Map([['huge', 34 * 1024 * 1024], ['rejected', 100]]);
  assert.deepEqual(duplicateAnchorKeys(frames, new Set([100, 34 * 1024 * 1024]), (key) => sizes.get(key)), []);
});
