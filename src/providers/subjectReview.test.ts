import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { finalSubjectSourceMatches, reviewOnlySubjectObservation } from './subjectReview';
import type { SelectEvidence } from '../core/subjectDetailBurst';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const signal = () => new AbortController().signal;

test('unchanged immutable original remains valid after crop drawing', async () => {
  const original = new Blob(['original pixels']);
  assert.equal(await finalSubjectSourceMatches(original, sha('original pixels'), {
    isCurrent: () => true, read: async () => original,
  }, signal()), true);
});

test('same-sized replacement linked original fails final digest', async () => {
  assert.equal(await finalSubjectSourceMatches(new Blob(['ABCDEF']), sha('ABCDEF'), {
    isCurrent: () => true, read: async () => new Blob(['UVWXYZ']),
  }, signal()), false);
});

test('photo switch during final original read discards stale crops', async () => {
  const original = new Blob(['original pixels']);
  let current = true;
  assert.equal(await finalSubjectSourceMatches(original, sha('original pixels'), {
    isCurrent: () => current,
    read: async () => { current = false; return original; },
  }, signal()), false);
});

test('abort, unavailable original and read failure abstain', async () => {
  const original = new Blob(['original pixels']);
  const stopped = new AbortController();
  stopped.abort();
  assert.equal(await finalSubjectSourceMatches(original, sha('original pixels'), {
    isCurrent: () => true, read: async () => original,
  }, stopped.signal), false);
  assert.equal(await finalSubjectSourceMatches(original, sha('original pixels'), {
    isCurrent: () => true, read: async () => undefined,
  }, signal()), false);
  assert.equal(await finalSubjectSourceMatches(original, sha('original pixels'), {
    isCurrent: () => true, read: async () => { throw Error('offline NAS'); },
  }, signal()), false);
});

const detectorEvidence = (): SelectEvidence => ({
  photoId: 'photo-1', sourceSha256: 'a'.repeat(64),
  modelId: 'yolox-tiny', modelVersion: 'local-revision-1',
  genre: 'bird', subjectScore: 0.8,
  subjectBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  manualDecision: 'review',
});

test('two distinct animals keep separate original-bound ROIs without species or keeper claims', () => {
  const a = detectorEvidence();
  const b = { ...detectorEvidence(), subjectBox: { x: 0.55, y: 0.2, width: 0.3, height: 0.4 } };
  const rows = [a, b].map(e => reviewOnlySubjectObservation(e, 'photo-1', 'a'.repeat(64)));
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.status, 'needs-review');
  assert.equal(rows[1]?.status, 'needs-review');
  assert.notDeepEqual(rows[0]?.subjectBox, rows[1]?.subjectBox);
  assert.equal('species' in rows[0]!, false);
  assert.equal('manualDecision' in rows[0]!, false);
});

test('mismatched photo or original SHA cannot be surfaced as review evidence', () => {
  assert.equal(reviewOnlySubjectObservation(detectorEvidence(), 'photo-2', 'a'.repeat(64)), null);
  assert.equal(reviewOnlySubjectObservation(detectorEvidence(), 'photo-1', 'b'.repeat(64)), null);
  assert.equal(reviewOnlySubjectObservation(detectorEvidence(), 'photo-1', 'not-a-sha'), null);
});

test('non-finite and out-of-bounds detector ROIs fail closed', () => {
  for (const subjectBox of [
    { x: Number.NaN, y: 0.2, width: 0.3, height: 0.4 },
    { x: 0.9, y: 0.2, width: 0.3, height: 0.4 },
    { x: 0.1, y: 0.2, width: 0, height: 0.4 },
  ]) {
    assert.equal(reviewOnlySubjectObservation({ ...detectorEvidence(), subjectBox }, 'photo-1', 'a'.repeat(64)), null);
  }
});

test('aircraft stays a needs-review observation, never confirmed bird search text', () => {
  const observation = reviewOnlySubjectObservation(
    { ...detectorEvidence(), genre: 'aircraft' }, 'photo-1', 'a'.repeat(64));
  assert.equal(observation?.status, 'needs-review');
  assert.equal('genre' in observation!, false);
});
