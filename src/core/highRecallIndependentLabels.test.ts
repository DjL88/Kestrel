import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recommendForReview, type ReviewCandidate } from './highRecallReviewPolicy';

/**
 * Independent synthetic labels: the oracle is deliberately NOT derived from
 * the policy's quality input. This measures recommendation limitations, not
 * photographic accuracy. A "review" remains visible to the photographer.
 */
function measure(frames: readonly ReviewCandidate[], oracle: ReadonlySet<string>) {
  const suggestions = recommendForReview(frames);
  const nominated = new Set(suggestions.filter(s => s.reason === 'best-in-group').map(s => s.id));
  const reviewable = new Set(suggestions.filter(s => s.suggestion !== 'reject').map(s => s.id));
  const hits = [...oracle].filter(id => nominated.has(id)).length;
  const retained = [...oracle].filter(id => reviewable.has(id)).length;
  return {
    nominationRecall: oracle.size ? hits / oracle.size : null,
    reviewCoverage: oracle.size ? retained / oracle.size : null,
    autoRejects: suggestions.filter(s => s.suggestion === 'reject' && s.reason !== 'manual').length,
    nominated: nominated.size,
  };
}

test('500 independently labelled synthetic frames reveal ranking errors without discarding winners', () => {
  const subjects = ['bird', 'aircraft', 'person', 'mammal', 'landscape'] as const;
  const frames: ReviewCandidate[] = [];
  const oracle = new Set<string>();
  for (let group = 0; group < 100; group++) {
    for (let frame = 0; frame < 5; frame++) {
      const id = `independent-${group}-${frame}`;
      // The labelled winner is frame 0, while the deliberately misleading
      // quality heuristic ranks frame 4 first. This is an adversarial fixture.
      if (frame === 0) oracle.add(id);
      frames.push({
        id, groupId: `burst-${group}`, subject: subjects[group % 5],
        quality: 0.2 + frame * 0.15, confidence: 0.95, eyeDetected: false,
      });
    }
  }
  const before = JSON.stringify(frames);
  const metrics = measure(frames, oracle);
  assert.equal(frames.length, 500);
  assert.equal(metrics.nominationRecall, 0);
  assert.equal(metrics.reviewCoverage, 1);
  assert.equal(metrics.nominated, 100);
  assert.equal(metrics.autoRejects, 0);
  assert.equal(JSON.stringify(frames), before);
});

test('detector outage keeps independently labelled winner available for review', () => {
  const frames: ReviewCandidate[] = [
    { id: 'actual-best', subject: 'aircraft', groupId: 'burst', quality: 0.99, confidence: null },
    { id: 'confident-other', subject: 'aircraft', groupId: 'burst', quality: 0.8, confidence: 0.99 },
  ];
  const metrics = measure(frames, new Set(['actual-best']));
  assert.equal(metrics.nominationRecall, 0);
  assert.equal(metrics.reviewCoverage, 1);
  assert.equal(metrics.autoRejects, 0);
});

test('explicit manual reject is excluded from review coverage, not counted as automatic rejection', () => {
  const frames: ReviewCandidate[] = [
    { id: 'chosen', subject: 'person', manualDecision: 'reject' },
  ];
  const metrics = measure(frames, new Set(['chosen']));
  assert.equal(metrics.nominationRecall, 0);
  assert.equal(metrics.reviewCoverage, 0);
  assert.equal(metrics.autoRejects, 0);
});
