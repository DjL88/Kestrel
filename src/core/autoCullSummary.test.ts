import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeCullSuggestions } from './autoCullSummary';
import type { CullSuggestion } from './autoCull';

const item = (id: string, decision: CullSuggestion['decision'], confidence: CullSuggestion['confidence'], reason: CullSuggestion['reason']): CullSuggestion =>
  ({ frameId: id, decision, confidence, reason, score: 80 });

test('a 300-photo scan reports the actual 20/280 result without inventing rejections', () => {
  const results: CullSuggestion[] = [
    ...Array.from({ length: 20 }, (_, i) => item(`keeper-${i}`, 'keep', 'high', 'clearDetail')),
    ...Array.from({ length: 280 }, (_, i) => item(`duplicate-${i}`, 'reject', 'high', 'duplicate')),
  ];
  assert.deepEqual(summarizeCullSuggestions(results), {
    total: 300, automaticKeep: 20, automaticDuplicate: 280, otherHighReject: 0, needReview: 0,
  });
});

test('remaining photos are counted for review when score is uncertain or a target is reached', () => {
  const results = [
    item('keeper', 'keep', 'high', 'clearDetail'),
    item('extra', 'keep', 'medium', 'clearDetail'),
    item('flat', 'reject', 'medium', 'flat'),
    item('missing', null, 'low', 'unavailable'),
    item('duplicate', 'reject', 'high', 'duplicate'),
  ];
  assert.deepEqual(summarizeCullSuggestions(results), {
    total: 5, automaticKeep: 1, automaticDuplicate: 1, otherHighReject: 0, needReview: 3,
  });
});

test('repeat high-confidence worker results count one photo, not multiple keepers', () => {
  assert.deepEqual(summarizeCullSuggestions([
    item('bird', 'keep', 'high', 'subjectSharp'),
    item('bird', 'keep', 'high', 'subjectSharp'),
  ]), { total: 1, automaticKeep: 1, automaticDuplicate: 0, otherHighReject: 0, needReview: 0 });
});

test('conflicting worker results stay review-only regardless of message order', () => {
  const confident = item('bird', 'keep', 'high', 'subjectSharp');
  for (const conflicting of [
    item('bird', null, 'low', 'noSubject'),
    item('bird', 'reject', 'high', 'duplicate'),
  ]) {
    for (const results of [
      [confident, conflicting],
      [conflicting, confident],
      [confident, conflicting, confident],
    ]) {
      assert.deepEqual(summarizeCullSuggestions(results), {
        total: 1, automaticKeep: 0, automaticDuplicate: 0, otherHighReject: 0, needReview: 1,
      });
    }
  }
});

test('malformed high-confidence worker scores remain review-only, including duplicate claims', () => {
  for (const score of [NaN, Infinity, -Infinity, -1, 101]) {
    for (const decision of ['keep', 'reject'] as const) {
      const result: CullSuggestion = { ...item('uncertain', decision, 'high', decision === 'keep' ? 'subjectSharp' : 'duplicate'), score };
      assert.deepEqual(summarizeCullSuggestions([result]), {
        total: 1, automaticKeep: 0, automaticDuplicate: 0, otherHighReject: 0, needReview: 1,
      }, String(score));
      assert.deepEqual(summarizeCullSuggestions([
        item('uncertain', 'keep', 'high', 'subjectSharp'), result,
      ]), { total: 1, automaticKeep: 0, automaticDuplicate: 0, otherHighReject: 0, needReview: 1 });
    }
  }
  assert.deepEqual(summarizeCullSuggestions([
    { ...item('valid', 'keep', 'high', 'subjectSharp'), score: 100 },
    { ...item('valid-reject', 'reject', 'high', 'duplicate'), score: 0 },
  ]), { total: 2, automaticKeep: 1, automaticDuplicate: 1, otherHighReject: 0, needReview: 0 });
});
