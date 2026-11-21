import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guidedStep, remainingWereScanned } from './guidedProgress';

test('an empty project has nothing to guide towards', () => {
  assert.equal(guidedStep({ all: 0, unreviewed: 0, keep: 0 }, 0), 'empty');
});

test('any unreviewed photo means reviewing, whatever else is true', () => {
  assert.equal(guidedStep({ all: 10, unreviewed: 1, keep: 9 }, 0), 'reviewing');
  assert.equal(guidedStep({ all: 10, unreviewed: 10, keep: 0 }, 0), 'reviewing');
});

test('everything decided but nothing kept has nothing constructive to suggest', () => {
  assert.equal(guidedStep({ all: 10, unreviewed: 0, keep: 0 }, 0), 'none');
});

test('decided, with keepers, and some unedited: improving', () => {
  assert.equal(guidedStep({ all: 10, unreviewed: 0, keep: 5 }, 3), 'improving');
  // Even one unedited keeper out of many is still "improving", not "ready".
  assert.equal(guidedStep({ all: 10, unreviewed: 0, keep: 5 }, 1), 'improving');
});

test('decided, with keepers, all already edited: ready', () => {
  assert.equal(guidedStep({ all: 10, unreviewed: 0, keep: 5 }, 0), 'ready');
});

test('the not-confident wording is used only for photos an automatic scan actually looked at', () => {
  const frame = (id: string, decision: 'keep' | 'reject' | 'unreviewed', extra = {}) => ({
    id, stableKey: id, filename: id, sequenceIndex: 1, decision, burstGroupId: null, burstIndex: 1, burstCount: 1,
    exif: {}, isDemo: false, sourceKind: 'file' as const, ...extra,
  });
  // Decided by hand, Auto-cull never ran: Kite44 made no judgement.
  assert.equal(remainingWereScanned([frame('a', 'keep'), frame('b', 'unreviewed')]), false);
  // A scan looked at the photo and left it: honest to say it wasn't confident.
  assert.equal(remainingWereScanned([frame('a', 'keep'), frame('b', 'unreviewed', { cullConfidence: 'low' })]), true);
  // A photo added after the scan has not been looked at.
  assert.equal(remainingWereScanned([frame('b', 'unreviewed', { cullConfidence: 'low' }), frame('c', 'unreviewed')]), false);
  // Removed photos (even at epoch zero) do not count.
  assert.equal(remainingWereScanned([frame('b', 'unreviewed', { cullConfidence: 'low' }), frame('c', 'unreviewed', { removedAt: 0 })]), true);
  assert.equal(remainingWereScanned([frame('a', 'keep')]), false);
});
