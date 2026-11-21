import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FoundSubject } from '../providers/objectDetector';
import { multiSubjectSelectEvidence } from './multiSubjectEvidence';
const source = { photoId: 'photo-1', sourceSha256: 'a'.repeat(64), width: 1000, height: 800, modelVersion: 'verified-v1', burstId: 'burst' };
const found = (label: string, x: number): FoundSubject => ({
  detection: { label, classId: label === 'bird' ? 14 : 4, score: 0.8, box: { x, y: 80, w: 120, h: 100 } },
  sharpness: 9, coverage: 0.015,
});
test('two real bird boxes remain distinct, source-bound, and review-only', () => {
  const rows = multiSubjectSelectEvidence(source, [found('bird', 20), found('bird', 500)]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.index), [0, 1]);
  assert.deepEqual(rows.map(r => r.evidence.subjectCount), [2, 2]);
  assert.deepEqual(rows.map(r => r.evidence.manualDecision), ['review', 'review']);
  assert.equal(rows[0].evidence.subjectBox?.x, 0.02);
  assert.equal(rows[1].evidence.subjectBox?.x, 0.5);
  assert.equal(rows[0].evidence.subjectTrackId, undefined);
  assert.equal(rows[0].evidence.eyeSharpness, undefined);
});
test('aircraft is never promoted to a bird or a species', () => {
  const rows = multiSubjectSelectEvidence(source, [found('aeroplane', 30)]);
  assert.equal(rows[0].evidence.genre, 'aircraft');
  assert.equal(rows[0].evidence.manualDecision, 'review');
  assert.equal(rows[0].evidence.birdScore, undefined);
});
test('invalid original hash or a single invalid detection fails closed', () => {
  assert.deepEqual(multiSubjectSelectEvidence({ ...source, sourceSha256: 'not-hash' }, [found('bird', 20)]), []);
  assert.deepEqual(multiSubjectSelectEvidence(source, [found('bird', 20), found('bird', 990)]), []);
});
test('cross-genre boxes retain their actual class and no invented eye evidence', () => {
  const rows = multiSubjectSelectEvidence(source, [found('person', 20), found('dog', 400)]);
  assert.deepEqual(rows.map(r => r.evidence.genre), ['person', 'pet']);
  assert.ok(rows.every(r => r.evidence.eyeBox === undefined));
});
