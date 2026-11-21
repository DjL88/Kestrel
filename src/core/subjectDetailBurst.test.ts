import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectBurstDetails, type SelectEvidence } from './subjectDetailBurst';

const base = (id: string, overrides: Partial<SelectEvidence> = {}): SelectEvidence => ({
  photoId: id, sourceSha256: 'a'.repeat(64), modelId: 'local-detector',
  modelVersion: 'fixture-v1', genre: 'bird', burstId: 'shoot-1',
  birdScore: 0.92, aircraftScore: 0.08, subjectSharpness: 0.8,
  eyeSharpness: 0.8, motionBlur: 0.1, poseScore: 0.8,
  eyeBox: { x: 0.1, y: 0.2, width: 0.02, height: 0.02 }, ...overrides,
});

test('source-bound eye detail ranks a burst without auto-rejecting alternatives', () => {
  const frames = [base('soft', { eyeSharpness: 0.1 }), base('sharp', { eyeSharpness: 0.98 })];
  const before = JSON.stringify(frames);
  const result = selectBurstDetails(frames);
  assert.deepEqual(result.map(r => r.recommendation), ['review', 'keep']);
  assert.ok(result[1].crop && result[1].crop.width >= 0.08);
  assert.equal(JSON.stringify(frames), before);
});
test('aircraft masquerading as bird and absent opposing detector both abstain', () => {
  const frames = [base('helicopter', { aircraftScore: 0.94 }), base('no-negative', { aircraftScore: undefined })];
  assert.deepEqual(selectBurstDetails(frames).map(r => r.reason), ['conflict', 'conflict']);
});
test('manual keeper suppresses another nomination; duplicate identities never inherit decisions', () => {
  const frames = [base('manual', { manualDecision: 'keep' }), base('strong', { eyeSharpness: 1 }),
    base('collision', { manualDecision: 'reject' }), base('collision')];
  assert.deepEqual(selectBurstDetails(frames).map(r => r.recommendation), ['keep', 'review', 'review', 'review']);
});
test('cross-genre subjects do not require eyes or bird species labels', () => {
  const frames = ['sport', 'architecture', 'macro', 'landscape', 'travel', 'person', 'pet'].map((genre, i) =>
    base(String(i), { genre: genre as SelectEvidence['genre'], burstId: 'same', birdScore: undefined,
      aircraftScore: undefined, eyeSharpness: undefined, eyeBox: undefined, subjectBox: { x: 0.2, y: 0.3, width: 0.2, height: 0.3 } }));
  const results = selectBurstDetails(frames);
  assert.ok(results.every(r => r.recommendation === 'keep' && r.crop));
});
test('invalid source identity, model provenance, malformed geometry and unknown abstain', () => {
  const frames = [base('bad-hash', { sourceSha256: 'wrong' }),
    base('no-model', { modelVersion: '' }),
    base('bad-box', { eyeBox: { x: 0.9, y: 0.9, width: 0.5, height: 0.5 } }),
    base('unknown', { genre: 'unknown' })];
  assert.ok(selectBurstDetails(frames).every(r => r.recommendation === 'review'));
});
test('500 synthetic frames: deterministic keeper nomination, no automatic rejects or input mutation', () => {
  const frames = Array.from({ length: 500 }, (_, i) => base('p-' + i, {
    genre: i % 2 ? 'bird' : 'aircraft', burstId: 'g-' + Math.floor(i / 10),
    birdScore: i % 2 ? 0.9 : 0.1, aircraftScore: i % 2 ? 0.1 : 0.9,
    eyeSharpness: i / 500, subjectSharpness: i / 500,
  }));
  const before = JSON.stringify(frames);
  const first = selectBurstDetails(frames);
  const second = selectBurstDetails([...frames].reverse());
  assert.equal(first.filter(r => r.recommendation === 'reject').length, 0);
  assert.deepEqual(first.filter(r => r.recommendation === 'keep').map(r => r.photoId).sort(),
    second.filter(r => r.recommendation === 'keep').map(r => r.photoId).sort());
  assert.equal(JSON.stringify(frames), before);
});
