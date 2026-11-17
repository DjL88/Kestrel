import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recommendForReview, type ReviewCandidate } from './highRecallReviewPolicy';

/**
 * Synthetic-only labelled fixture. These labels are constructed from the same
 * quality scores the policy receives, so this tests deterministic policy
 * behaviour, NOT photographic accuracy or real-shoot recall.
 */
test('500-frame five-subject synthetic recall and zero automatic rejects', () => {
  const subjects = ['bird', 'aircraft', 'person', 'mammal', 'landscape'] as const;
  const frames: ReviewCandidate[] = [];
  const labelledBest = new Set<string>();
  for (let group = 0; group < 100; group++) {
    const subject = subjects[group % subjects.length];
    for (let frame = 0; frame < 5; frame++) {
      const id = `group-${group}-frame-${frame}`;
      frames.push({
        id, subject, groupId: `group-${group}`,
        quality: frame === 3 ? 0.98 : 0.15 + frame * 0.1,
        confidence: 0.95, eyeDetected: false,
      });
      if (frame === 3) labelledBest.add(id);
    }
  }
  const snapshot = JSON.stringify(frames);
  const result = recommendForReview(frames);
  const nominated = new Set(result.filter(r => r.reason === 'best-in-group').map(r => r.id));
  const truePositive = [...labelledBest].filter(id => nominated.has(id)).length;
  assert.equal(frames.length, 500);
  assert.equal(truePositive / labelledBest.size, 1);
  assert.equal(nominated.size, 100);
  assert.equal(result.filter(r => r.suggestion === 'reject').length, 0);
  assert.equal(JSON.stringify(frames), snapshot);
});

test('detector outage defers review instead of losing a synthetic best shot', () => {
  const frames: ReviewCandidate[] = [
    { id: 'best', subject: 'bird', groupId: 'burst', quality: 0.99, confidence: null },
    { id: 'other', subject: 'bird', groupId: 'burst', quality: 0.7, confidence: 0.95 },
  ];
  const result = recommendForReview(frames);
  assert.equal(result[0].suggestion, 'review');
  assert.equal(result[0].reason, 'uncertain-detection');
  assert.ok(result.every(r => r.suggestion !== 'reject'));
});

test('manual keeper survives rescan and prevents extra burst nomination', () => {
  const frames: ReviewCandidate[] = [
    { id: 'chosen', subject: 'mammal', groupId: 'burst', manualDecision: 'keep' },
    { id: 'candidate', subject: 'mammal', groupId: 'burst', quality: 1, confidence: 1 },
  ];
  assert.deepEqual(recommendForReview(frames).map(r => r.suggestion), ['keep', 'review']);
});
