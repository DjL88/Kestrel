import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeDeepReviewForTest as describeDeepReview, suggestDeepReviewLook, candidatesForSuggestedLook } from './deepVisionReview.ts';
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


describe('suggestDeepReviewLook', () => {
  it('offers the existing Look only for a trusted sharp subject', () => {
    assert.equal(suggestDeepReviewLook(result({}), true)?.id, LIFT_SUBJECT_BLUR_BACKGROUND.id);
  });

  it('does not treat a detector box as a usable pixel mask', () => {
    assert.equal(suggestDeepReviewLook(result({})), null);
    assert.equal(suggestDeepReviewLook(result({}), false), null);
  });

  it('refuses a Look when the scene reading contradicts the detector', () => {
    const conflicting = result({ corroboration: { state: 'conflict', reading: 'aircraft', detector: 'bird' } });
    assert.equal(suggestDeepReviewLook(conflicting), null);
    assert.match(describeDeepReview(conflicting, suggestDeepReviewLook(conflicting)), /unresolved/);
    assert.doesNotMatch(describeDeepReview(conflicting, suggestDeepReviewLook(conflicting)), /Suggested:/);
  });

  it('refuses a Look when no subject is found or the detector is unsure', () => {
    assert.equal(suggestDeepReviewLook(result({ finding: null })), null);
    assert.equal(suggestDeepReviewLook(result({ trust: { frameId: 'f1', decision: null, confidence: 'low', score: 20, reason: 'subjectSoft' } })), null);
  });
});

describe('candidatesForSuggestedLook', () => {
  it('returns no candidate for a conflicting or uncertain detection', () => {
    const conflicting = result({ corroboration: { state: 'conflict', reading: 'aircraft', detector: 'bird' } });
    const uncertain = result({ trust: { frameId: 'f1', decision: null, confidence: 'low', score: 20, reason: 'subjectSoft' } });
    assert.deepEqual(candidatesForSuggestedLook(suggestDeepReviewLook(conflicting)), []);
    assert.deepEqual(candidatesForSuggestedLook(suggestDeepReviewLook(uncertain)), []);
  });

  it('returns exactly one grounded proposal without applying or changing the Look', () => {
    const look = suggestDeepReviewLook(result({}), true);
    assert.ok(look);
    const before = structuredClone(look);
    const candidates = candidatesForSuggestedLook(look);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].look, look);
    assert.equal(candidates[0].id, look.id);
    assert.deepEqual(look, before);
    assert.equal(Object.hasOwn(candidates[0], 'applied'), false);
    assert.equal(Object.hasOwn(candidates[0], 'pixels'), false);
  });
});
