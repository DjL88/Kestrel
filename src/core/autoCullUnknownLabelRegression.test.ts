import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeSubject, scoreWithSubject, type CullSuggestion, type SubjectFinding } from './autoCull';

const base: CullSuggestion = {
  frameId: 'frame-1', decision: 'keep', confidence: 'high',
  score: 96, reason: 'clearDetail',
};

test('punctuation after an unknown detector prefix cannot auto-keep', () => {
  const finding: SubjectFinding = { label: 'bird', score: 0.99, size: 600, sharpness: 25 };
  for (const label of [
    'unknown.bird', 'unknown—bird', 'unknown–bird', 'UNKNOWN：bird',
    'unidentified…aircraft', 'unrecognised·dog', 'unrecognized|bird',
    'other.bird', 'none—animal', 'n/a.bird',
  ]) {
    const actual = scoreWithSubject(base, { ...finding, label });
    assert.deepEqual(
      [actual.decision, actual.confidence, actual.reason, actual.score],
      [null, 'low', 'noSubject', 35], label,
    );
  }
});

test('genuine named subjects still retain their normal culling evidence', () => {
  for (const label of ['bird', 'red kite', 'dog', 'aircraft', 'otherworldly bird']) {
    const actual = judgeSubject({ label, score: 0.95, size: 400, sharpness: 22 });
    assert.deepEqual([actual.decision, actual.confidence, actual.reason],
      ['keep', 'high', 'subjectSharp'], label);
  }
});

test('uncertain-label abstention never mutates the detector result or frame score', () => {
  const finding = Object.freeze({ label: 'unknown—bird', score: 0.99, size: 400, sharpness: 22 });
  const original = Object.freeze({ ...base });
  const actual = scoreWithSubject(original, finding);
  assert.equal(actual.decision, null);
  assert.deepEqual(original, base);
  assert.deepEqual(finding, { label: 'unknown—bird', score: 0.99, size: 400, sharpness: 22 });
});
