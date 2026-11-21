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

test('a multi-bird scene without source-bound tracks abstains instead of pooling different birds', () => {
  const evidence = [
    base('both-birds', { subjectCount: 2, subjectSharpness: 0.95 }),
    base('bird-alone', { subjectCount: 1, subjectSharpness: 0.8 }),
  ];
  const result = selectBurstDetails(evidence);
  assert.deepEqual(result.map(r => r.recommendation), ['review', 'review']);
  assert.ok(result.every(r => r.comparisonGroup === null));
});

test('independently tracked birds can each earn a conservative nomination in the same capture burst', () => {
  const evidence = [
    base('red-a', { subjectCount: 2, subjectTrackId: 'red', subjectSharpness: 0.9 }),
    base('red-b', { subjectCount: 2, subjectTrackId: 'red', subjectSharpness: 0.3 }),
    base('blue-a', { subjectCount: 2, subjectTrackId: 'blue', subjectSharpness: 0.3 }),
    base('blue-b', { subjectCount: 2, subjectTrackId: 'blue', subjectSharpness: 0.95 }),
  ];
  const result = selectBurstDetails(evidence);
  assert.deepEqual(result.map(r => r.recommendation), ['keep', 'review', 'review', 'keep']);
  assert.notEqual(result[0].comparisonGroup, result[3].comparisonGroup);
  assert.deepEqual(selectBurstDetails([...evidence].reverse()).filter(r => r.recommendation === 'keep')
    .map(r => r.photoId).sort(), ['blue-b', 'red-a']);
});

test('mixed model versions, zero subjects and untrusted tracks are review-only, not confident keepers', () => {
  const evidence = [
    base('v1', { modelVersion: 'v1' }),
    base('v2', { modelVersion: 'v2' }),
    base('none', { burstId: 'another', subjectCount: 0 }),
    base('bad-track', { burstId: 'third', subjectCount: 2, subjectTrackId: 'red bird' }),
    base('bad-manual', { burstId: 'fourth', manualDecision: 'force-keep' as 'keep' }),
  ];
  const result = selectBurstDetails(evidence);
  assert.ok(result.every(r => r.recommendation === 'review'));
  assert.ok(result.every(r => r.comparisonGroup === null));
  assert.equal(result[4].reason, 'uncertain');
});

test('manual Keep still takes precedence within a verified multi-bird track', () => {
  const evidence = [
    base('manual', { subjectCount: 2, subjectTrackId: 'bird-1', manualDecision: 'keep' }),
    base('stronger', { subjectCount: 2, subjectTrackId: 'bird-1', eyeSharpness: 1, subjectSharpness: 1 }),
  ];
  assert.deepEqual(selectBurstDetails(evidence).map(r => r.recommendation), ['keep', 'review']);
});

test('two individually tracked birds in one exposure retain distinct reviewable crops', () => {
  const subjectBoxA = { x: 0.1, y: 0.2, width: 0.15, height: 0.2 };
  const subjectBoxB = { x: 0.7, y: 0.3, width: 0.15, height: 0.2 };
  const evidence = [
    base('both', { subjectCount: 2, subjectTrackId: 'bird-a', subjectBox: subjectBoxA, eyeBox: undefined }),
    base('both', { subjectCount: 2, subjectTrackId: 'bird-b', subjectBox: subjectBoxB, eyeBox: undefined }),
    base('next-a', { subjectCount: 2, subjectTrackId: 'bird-a', subjectBox: subjectBoxA, eyeBox: undefined }),
    base('next-b', { subjectCount: 2, subjectTrackId: 'bird-b', subjectBox: subjectBoxB, eyeBox: undefined }),
  ];
  const result = selectBurstDetails(evidence);
  assert.ok(result.every(row => row.crop && row.comparisonGroup));
  assert.notEqual(result[0].comparisonGroup, result[1].comparisonGroup);
  assert.notDeepEqual(result[0].crop, result[1].crop);
  assert.equal(result.filter(row => row.recommendation === 'reject').length, 0);
});

test('duplicate subject tracks or conflicting source hashes cannot inherit a keeper', () => {
  const frames = [
    base('same', { subjectCount: 2, subjectTrackId: 'a', manualDecision: 'keep', subjectBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }),
    base('same', { subjectCount: 2, subjectTrackId: 'b', subjectBox: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 } }),
    base('collision', { subjectCount: 2, subjectTrackId: 'a', subjectBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }),
    base('collision', { subjectCount: 2, subjectTrackId: 'a', subjectBox: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 } }),
    base('replacement', { subjectCount: 2, subjectTrackId: 'a', subjectBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }),
    base('replacement', { subjectCount: 2, subjectTrackId: 'b', sourceSha256: 'b'.repeat(64), subjectBox: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 } }),
  ];
  const result = selectBurstDetails(frames);
  assert.ok(result.every(row => row.recommendation === 'review' && row.comparisonGroup === null));
});

test('untracked animals in the same photo abstain rather than assuming continuity', () => {
  const evidence = [
    base('two', { subjectCount: 2, subjectBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }),
    base('two', { subjectCount: 2, subjectBox: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 } }),
  ];
  assert.ok(selectBurstDetails(evidence).every(row =>
    row.recommendation === 'review' && row.comparisonGroup === null));
});

test('contradictory single-animal count cannot nominate two tracked animals from one frame', () => {
  const rows = [
    base('frame', { subjectCount: 1, subjectTrackId: 'a', subjectBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, eyeBox: undefined }),
    base('frame', { subjectCount: 1, subjectTrackId: 'b', subjectBox: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 }, eyeBox: undefined }),
  ];
  assert.ok(selectBurstDetails(rows).every(r => r.recommendation === 'review' && r.comparisonGroup === null));
});

test('two tracks with inconsistent counts or duplicate boxes cannot claim separate subjects', () => {
  const boxA = { x: 0.2, y: 0.2, width: 0.2, height: 0.2 };
  const boxB = { x: 0.7, y: 0.2, width: 0.2, height: 0.2 };
  for (const boxes of [[boxA, boxA], [boxA, boxB]]) {
    const rows = [
      base('frame', { subjectCount: 2, subjectTrackId: 'a', subjectBox: boxes[0], eyeBox: undefined }),
      base('frame', { subjectCount: boxes[0] === boxes[1] ? 2 : 3, subjectTrackId: 'b', subjectBox: boxes[1], eyeBox: undefined }),
    ];
    assert.ok(selectBurstDetails(rows).every(r => r.recommendation === 'review' && r.comparisonGroup === null));
  }
});

test('two independently observed boxes with matching count preserve reviewable crops', () => {
  const rows = [
    base('frame', { subjectCount: 2, subjectTrackId: 'a', subjectBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, eyeBox: undefined }),
    base('frame', { subjectCount: 2, subjectTrackId: 'b', subjectBox: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 }, eyeBox: undefined }),
  ];
  const results = selectBurstDetails(rows);
  assert.ok(results.every(r => r.crop && r.comparisonGroup && r.recommendation !== 'reject'));
});

test('cross-genre duplicate detector boxes cannot create independent animal identities', () => {
  const frame = (count: number, aircraftBox: { x: number; y: number; width: number; height: number }) => [
    base('same-source', { subjectCount: count, subjectTrackId: 'bird-a', eyeBox: undefined,
      subjectBox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }),
    base('same-source', { genre: 'aircraft', birdScore: 0.08, aircraftScore: 0.92,
      subjectCount: count, subjectTrackId: 'aircraft-b', eyeBox: undefined, subjectBox: aircraftBox }),
  ];
  // A single frame cannot contain two tracked subjects if the detector counted only one,
  // even when one head labels a bird and the other an aircraft.
  const distinct = { x: 0.7, y: 0.1, width: 0.2, height: 0.2 };
  const duplicate = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
  for (const evidence of [frame(1, distinct), frame(2, duplicate)]) {
    const result = selectBurstDetails(evidence);
    assert.ok(result.every(r => r.recommendation === 'review' && r.comparisonGroup === null && r.crop === null));
  }
  // Two separate supported boxes with a count of two remain reviewable,
  // irrespective of genre, without ever issuing an automatic Reject.
  const accepted = selectBurstDetails(frame(2, distinct));
  assert.ok(accepted.every(r => r.crop && r.comparisonGroup && r.recommendation !== 'reject'));
});
