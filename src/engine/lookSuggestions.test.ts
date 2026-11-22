import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { suggestLookForPhoto, suggestLooksForPhotos } from './lookSuggestions.ts';
import { LIFT_SUBJECT_BLUR_BACKGROUND } from './looks.ts';
import type { CullSuggestion } from '../core/autoCull';

function cull(overrides: Partial<CullSuggestion>): CullSuggestion {
  return { frameId: 'f1', decision: 'keep', confidence: 'high', score: 90, reason: 'subjectSharp', ...overrides };
}

describe('suggestLookForPhoto', () => {
  it('suggests Lift subject/blur background for a real, sharp, high-confidence subject with a mask', () => {
    const look = suggestLookForPhoto(cull({}), true);
    assert.equal(look, LIFT_SUBJECT_BLUR_BACKGROUND);
  });

  it('suggests nothing without a subject mask to apply the Look to, even with a sharp subject', () => {
    assert.equal(suggestLookForPhoto(cull({}), false), null);
  });

  it('suggests nothing when the cull decision is not keep', () => {
    assert.equal(suggestLookForPhoto(cull({ decision: 'reject' }), true), null);
    assert.equal(suggestLookForPhoto(cull({ decision: null }), true), null);
  });

  it('suggests nothing when the subject is not confidently sharp', () => {
    assert.equal(suggestLookForPhoto(cull({ reason: 'subjectOk' }), true), null);
    assert.equal(suggestLookForPhoto(cull({ reason: 'clearDetail' }), true), null);
  });

  it('suggests nothing when confidence is not high, even if the subject read as sharp', () => {
    assert.equal(suggestLookForPhoto(cull({ confidence: 'medium' }), true), null);
  });
});

describe('suggestLooksForPhotos', () => {
  it('only includes frames a Look was actually suggested for', () => {
    const suggestions: CullSuggestion[] = [
      cull({ frameId: 'sharp-with-mask' }),
      cull({ frameId: 'sharp-no-mask' }),
      cull({ frameId: 'soft', reason: 'subjectOk' }),
    ];
    const result = suggestLooksForPhotos(suggestions, (id) => id === 'sharp-with-mask');
    assert.deepEqual([...result.keys()], ['sharp-with-mask']);
    assert.equal(result.get('sharp-with-mask'), LIFT_SUBJECT_BLUR_BACKGROUND);
  });
});
