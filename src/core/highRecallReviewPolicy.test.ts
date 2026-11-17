import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recommendForReview, type ReviewCandidate } from './highRecallReviewPolicy';

test('500-photo synthetic review keeps one per five-category group without auto-reject', () => {
  const subjects = ['bird', 'aircraft', 'person', 'mammal', 'landscape'] as const;
  const items: ReviewCandidate[] = Array.from({ length: 500 }, (_, i) => ({
    id: 'photo-' + i, subject: subjects[i % 5],
    groupId: 'burst-' + Math.floor(i / 10),
    confidence: 0.9, quality: (i % 10) / 10,
  }));
  const before = JSON.stringify(items);
  const suggestions = recommendForReview(items);
  assert.equal(suggestions.length, 500);
  assert.equal(suggestions.filter(s => s.suggestion === 'keep').length, 250);
  assert.equal(suggestions.filter(s => s.suggestion === 'reject').length, 0);
  assert.equal(JSON.stringify(items), before);
});

test('unknown, missing, NaN and infinite detections require review', () => {
  const items: ReviewCandidate[] = [
    { id: 'missing', subject: 'bird' },
    { id: 'nan', subject: 'person', quality: NaN, confidence: 0.99 },
    { id: 'infinite', subject: 'mammal', quality: Infinity, confidence: 0.99 },
    { id: 'low', subject: 'aircraft', quality: 0.95, confidence: 0.4 },
    { id: 'invalid', subject: 'landscape', quality: 1.2, confidence: 0.99 },
  ];
  assert.ok(recommendForReview(items).every(s => s.suggestion === 'review'));
});

test('manual decisions override detector recommendations and remain immutable', () => {
  const items: ReviewCandidate[] = [
    { id: 'a', subject: 'bird', groupId: 'g', quality: 1, confidence: 1, manualDecision: 'reject' },
    { id: 'b', subject: 'bird', groupId: 'g', quality: 0.8, confidence: 0.9, manualDecision: 'keep' },
    { id: 'c', subject: 'bird', groupId: 'g', quality: 0.7, confidence: 0.9 },
  ];
  assert.deepEqual(recommendForReview(items).map(s => s.suggestion), ['reject', 'keep', 'review']);
});

test('eye detection absence never forces reject, including aircraft and landscape', () => {
  for (const subject of ['bird', 'aircraft', 'person', 'mammal', 'landscape'] as const) {
    assert.equal(recommendForReview([{ id: subject, subject, quality: 0.9, confidence: 0.8, eyeDetected: false }])[0].suggestion, 'keep');
  }
});

test('duplicate identities never receive automatic keeps, even across groups', () => {
  const items: ReviewCandidate[] = [
    { id: 'same', subject: 'bird', groupId: 'one', quality: 1, confidence: 1 },
    { id: 'same', subject: 'bird', groupId: 'two', quality: 1, confidence: 1 },
    { id: 'unique', subject: 'bird', groupId: 'one', quality: 0.8, confidence: 0.9 },
  ];
  assert.deepEqual(recommendForReview(items).map(s => s.suggestion), ['review', 'review', 'keep']);
});

test('unknown subject and malformed group identity fall back without throwing', () => {
  const items: ReviewCandidate[] = [
    { id: 'unknown', subject: 'unknown', quality: 1, confidence: 1 },
    { id: 'bad-group', subject: 'bird', groupId: 12 as unknown as string, quality: 1, confidence: 1 },
    { id: 'blank', subject: 'bird', quality: 1, confidence: 1 },
  ];
  items[2].id = ' ';
  assert.deepEqual(recommendForReview(items).map(s => s.suggestion), ['review', 'review', 'review']);
});

test('subject and group keys cannot collide through colon separators', () => {
  const items: ReviewCandidate[] = [
    { id: 'one', subject: 'bird', groupId: 'a:b', quality: 0.8, confidence: 0.9 },
    { id: 'two', subject: 'bird', groupId: 'a:b', quality: 0.9, confidence: 0.9 },
  ];
  assert.deepEqual(recommendForReview(items).map(s => s.suggestion), ['review', 'keep']);
});


test('manual keeper prevents an extra automatic keeper within the same group', () => {
  const items: ReviewCandidate[] = [
    { id: 'manual', subject: 'bird', groupId: 'burst', quality: 0.2, confidence: 0.9, manualDecision: 'keep' },
    { id: 'strong', subject: 'bird', groupId: 'burst', quality: 1, confidence: 1 },
    { id: 'other', subject: 'aircraft', groupId: 'burst', quality: 0.8, confidence: 0.9 },
  ];
  assert.deepEqual(recommendForReview(items).map(s => s.suggestion), ['keep', 'review', 'keep']);
});

test('blank explicit group IDs fail conservatively instead of borrowing photo identity', () => {
  const items: ReviewCandidate[] = [
    { id: 'a', subject: 'bird', groupId: '   ', quality: 1, confidence: 1 },
    { id: 'b', subject: 'bird', groupId: 'burst', quality: 0.8, confidence: 0.9 },
  ];
  assert.deepEqual(recommendForReview(items).map(s => s.suggestion), ['review', 'keep']);
});


test('manual keeper with unavailable detector scores suppresses duplicate burst nominations', () => {
  const items: ReviewCandidate[] = [
    { id: 'manual', subject: 'bird', groupId: 'burst', manualDecision: 'keep' },
    { id: 'auto', subject: 'bird', groupId: 'burst', quality: 0.99, confidence: 0.99 },
    { id: 'other', subject: 'aircraft', groupId: 'burst', quality: 0.9, confidence: 0.9 },
  ];
  const snapshot = JSON.stringify(items);
  assert.deepEqual(recommendForReview(items).map(s => s.suggestion), ['keep', 'review', 'keep']);
  assert.equal(JSON.stringify(items), snapshot);
});


test('malformed persisted manual decisions never become recommendations', () => {
  const items: ReviewCandidate[] = [
    { id: 'invalid', subject: 'bird', groupId: 'burst', quality: 1, confidence: 1,
      manualDecision: 'archive' as unknown as 'keep' },
    { id: 'valid', subject: 'bird', groupId: 'burst', quality: 0.8, confidence: 0.9 },
  ];
  const snapshot = JSON.stringify(items);
  assert.deepEqual(recommendForReview(items).map(s => s.suggestion), ['review', 'keep']);
  assert.equal(JSON.stringify(items), snapshot);
});
