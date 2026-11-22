import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeDeepReviewForTest as describeDeepReview } from './deepVisionReview.ts';
import { LIFT_SUBJECT_BLUR_BACKGROUND } from '../../engine/looks';
import type { SubjectDetectActionResult } from '../../engine/subjectDetectAction';

function result(overrides: Partial<SubjectDetectActionResult>): SubjectDetectActionResult {
  return {
    finding: { detection: { label: 'bird', classId: 1, score: 0.8, box: { x: 0, y: 0, w: 200, h: 180 } }, sharpness: 20, coverage: 0.3 },
    trust: { frameId: 'f1', decision: 'keep', confidence: 'high', score: 95, reason: 'subjectSharp' },
    corroboration: { state: 'unverified' },
    ...overrides,
  };
}

describe('describeDeepReview', () => {
  it('reports no trusted subject plainly', () => {
    const summary = describeDeepReview({ finding: null, trust: { frameId: 'f1', decision: null, confidence: 'low', score: 0, reason: 'noSubject' }, corroboration: { state: 'unverified' } }, null);
    assert.match(summary, /no subject the detector trusts/);
  });

  it('describes a confident sharp subject with no corroboration available', () => {
    const summary = describeDeepReview(result({}), null);
    assert.match(summary, /high-confidence, sharp subject/);
    assert.doesNotMatch(summary, /Suggested:/);
  });

  it('includes agreement when the scene reading corroborates the detector', () => {
    const summary = describeDeepReview(result({ corroboration: { state: 'agreed', subject: 'bird' } }), null);
    assert.match(summary, /confirmed as a bird by the scene reading/);
  });

  it('flags a conflict between the scene reading and the detector as unresolved', () => {
    const summary = describeDeepReview(result({ corroboration: { state: 'conflict', reading: 'bird', detector: 'aircraft' } }), null);
    assert.match(summary, /disagrees/);
    assert.match(summary, /treat this as unresolved/);
  });

  it('appends the suggested Look\'s name and description when one is given', () => {
    const summary = describeDeepReview(result({}), LIFT_SUBJECT_BLUR_BACKGROUND);
    assert.match(summary, /Suggested: "Lift subject, blur background"/);
  });

  it('describes a soft, untrusted subject without suggesting a Look', () => {
    const summary = describeDeepReview(result({ trust: { frameId: 'f1', decision: null, confidence: 'low', score: 20, reason: 'subjectSoft' } }), null);
    assert.match(summary, /too soft to trust/);
  });
});
