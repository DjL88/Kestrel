import assert from 'node:assert/strict';
import test from 'node:test';
import { triageCullReview } from './cullReviewTriage';

test('uncertain and rejected suggestions are reviewed before confident keeps', () => {
  const frames = [
    { id: 'bird', decision: 'unreviewed' as const, suggestion: { decision: 'keep' as const, confidence: 'high' as const, score: 90 } },
    { id: 'aircraft', decision: 'unreviewed' as const, suggestion: { decision: 'reject' as const, confidence: 'medium' as const, score: 60 } },
    { id: 'mammal', decision: 'unreviewed' as const, suggestion: null },
    { id: 'landscape', decision: 'unreviewed' as const, suggestion: { decision: null, confidence: 'low' as const, score: 20 } },
    { id: 'person', decision: 'unreviewed' as const, suggestion: { decision: 'keep' as const, confidence: 'high' as const, score: 80 } },
  ];
  assert.deepEqual(triageCullReview(frames).map(x => x.id), ['aircraft', 'mammal', 'landscape', 'bird', 'person']);
  assert.equal(triageCullReview(frames)[0].reason, 'possibleFalseReject');
});
test('never requeues removed, manually reviewed, demo, virtual or duplicate identities', () => {
  const frames = [
    { id: 'a', decision: 'keep' as const },
    { id: 'b', decision: 'unreviewed' as const, removedAt: 123 },
    { id: 'c', decision: 'unreviewed' as const, isDemo: true },
    { id: 'd', decision: 'unreviewed' as const, virtualCopy: true },
    { id: 'e', decision: 'unreviewed' as const },
    { id: 'e', decision: 'unreviewed' as const },
  ];
  assert.deepEqual(triageCullReview(frames).map(x => x.id), ['e']);
});
test('invalid detector scores remain urgent and existing burst keeper is not changed', () => {
  const frames = [
    { id: 'keeper', decision: 'keep' as const, burstGroupId: 'burst' },
    { id: 'alt', decision: 'unreviewed' as const, burstGroupId: 'burst', suggestion: { decision: 'keep' as const, confidence: 'high' as const, score: 85 } },
    { id: 'bad', decision: 'unreviewed' as const, suggestion: { decision: 'keep' as const, confidence: 'high' as const, score: Number.NaN } },
  ];
  assert.deepEqual(triageCullReview(frames), [
    { id: 'bad', priority: 'urgent', reason: 'unscored' },
    { id: 'alt', priority: 'review', reason: 'burstAlternative' },
  ]);
  assert.equal(frames[0].decision, 'keep');
});
