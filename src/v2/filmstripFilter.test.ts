import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isFlagged, nextFlagToggle, visibleFrames, filmstripReadiness } from './filmstripFilter.ts';
import type { PhotoFrame } from '../core/types';

function frame(patch: Partial<PhotoFrame> = {}): PhotoFrame {
  return {
    id: 'f1', stableKey: 'f1', filename: 'IMG_0001.jpg', sequenceIndex: 0,
    decision: 'unreviewed', burstGroupId: null, burstIndex: 0, burstCount: 1,
    exif: {}, isDemo: true, sourceKind: 'demo',
    ...patch,
  } as PhotoFrame;
}

describe('isFlagged / nextFlagToggle', () => {
  it('only keep counts as flagged', () => {
    assert.equal(isFlagged('keep'), true);
    assert.equal(isFlagged('unreviewed'), false);
    assert.equal(isFlagged('reject'), false);
  });

  it('toggles keep to unreviewed and back', () => {
    assert.equal(nextFlagToggle('unreviewed'), 'keep');
    assert.equal(nextFlagToggle('keep'), 'unreviewed');
  });

  it('flags a previously-rejected photo to keep, and unflagging goes to unreviewed (not back to reject)', () => {
    assert.equal(nextFlagToggle('reject'), 'keep');
    assert.equal(nextFlagToggle(nextFlagToggle('reject')), 'unreviewed');
  });
});

describe('visibleFrames', () => {
  it('excludes removed photos under both filters', () => {
    const frames = [frame({ id: 'a' }), frame({ id: 'b', removedAt: Date.now() })];
    assert.deepEqual(visibleFrames(frames, 'all').map((f) => f.id), ['a']);
    assert.deepEqual(visibleFrames(frames, 'flagged').map((f) => f.id), []);
  });

  it('"all" shows unreviewed and reject frames too; "flagged" shows only keep', () => {
    const frames = [
      frame({ id: 'kept', decision: 'keep' }),
      frame({ id: 'unreviewed', decision: 'unreviewed' }),
      frame({ id: 'rejected', decision: 'reject' }),
    ];
    assert.deepEqual(visibleFrames(frames, 'all').map((f) => f.id), ['kept', 'unreviewed', 'rejected']);
    assert.deepEqual(visibleFrames(frames, 'flagged').map((f) => f.id), ['kept']);
  });
});

describe('filmstripReadiness', () => {
  it('is ready for a demo frame or one with a linked source path', () => {
    assert.equal(filmstripReadiness(frame({ isDemo: true, sourcePath: undefined })), 'ready');
    assert.equal(filmstripReadiness(frame({ isDemo: false, sourcePath: '/tmp/a.nef' })), 'ready');
  });

  it('is importing for a frame with neither (no real import pipeline wired in this slice)', () => {
    assert.equal(filmstripReadiness(frame({ isDemo: false, sourcePath: undefined })), 'importing');
  });
});
