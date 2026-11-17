import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreWithSubject, type CullSuggestion } from './autoCull';

const base: CullSuggestion = {
  frameId: 'frame', decision: 'keep', confidence: 'high',
  score: 96, reason: 'clearDetail',
};

test('tiny high-score detections remain reviewable but cannot auto-keep', () => {
  for (const label of ['bird', 'aeroplane', 'person', 'mammal']) {
    const result = scoreWithSubject(base, { label, score: 0.99, size: 48, sharpness: 25 });
    assert.deepEqual([result.decision, result.confidence, result.reason],
      ['keep', 'medium', 'subjectSharp'], label);
  }
});

test('normal-sized sharp subjects retain high-confidence keeper recommendation', () => {
  const result = scoreWithSubject(base, { label: 'aeroplane', score: 0.9, size: 120, sharpness: 20 });
  assert.deepEqual([result.decision, result.confidence, result.reason],
    ['keep', 'high', 'subjectSharp']);
});

test('tiny soft subjects and unrecognised subjects remain undecided', () => {
  assert.equal(scoreWithSubject(base, { label: 'bird', score: 0.95, size: 45, sharpness: 4 }).decision, null);
  const missing = scoreWithSubject(base, null);
  assert.deepEqual([missing.decision, missing.confidence], [null, 'low']);
});
