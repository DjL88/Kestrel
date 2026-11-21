import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanVerifiedSubjects, type VerifiedSubjectScan } from './verifiedSubjectScan';

const sha = 'a'.repeat(64);
const identity = { photoId: 'bird-1', sourceSha256: sha, width: 1000, height: 800, modelVersion: 'signed-yolox-v1', burstId: 'folder/burst' };
const bird = (x: number) => ({
  detection: { label: 'bird', classId: 14, score: 0.8, box: { x, y: 100, w: 120, h: 100 } },
  sharpness: 9, coverage: 0.015,
});
const base = (): VerifiedSubjectScan => ({
  source: {} as HTMLCanvasElement,
  identity,
  isCurrent: () => true,
  verifyOriginalSha256: async () => sha,
  detector: async () => [bird(20), bird(500)],
});

test('two real detector boxes are retained as separate review-only candidates', async () => {
  const rows = await scanVerifiedSubjects(base());
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.evidence.manualDecision), ['review', 'review']);
  assert.deepEqual(rows.map(r => r.evidence.subjectCount), [2, 2]);
  assert.ok(rows.every(r => r.evidence.eyeBox === undefined && r.evidence.subjectTrackId === undefined));
});

test('source replacement before inference fails closed', async () => {
  let called = false;
  const rows = await scanVerifiedSubjects({
    ...base(), verifyOriginalSha256: async () => 'b'.repeat(64),
    detector: async () => { called = true; return [bird(20)]; },
  });
  assert.deepEqual(rows, []);
  assert.equal(called, false);
});

test('source replacement after inference fails closed', async () => {
  let reads = 0;
  const rows = await scanVerifiedSubjects({
    ...base(), verifyOriginalSha256: async () => ++reads === 1 ? sha : 'b'.repeat(64),
  });
  assert.deepEqual(rows, []);
  assert.equal(reads, 2);
});

test('photo switch while inference awaits discards stale boxes', async () => {
  let current = true;
  const rows = await scanVerifiedSubjects({
    ...base(), isCurrent: () => current,
    detector: async () => { current = false; return [bird(20)]; },
  });
  assert.deepEqual(rows, []);
});

test('aborted, failed or excessive scans never change cull decisions', async () => {
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await scanVerifiedSubjects({ ...base(), signal: controller.signal }), []);
  assert.deepEqual(await scanVerifiedSubjects({ ...base(), detector: async () => { throw Error('offline'); } }), []);
  assert.deepEqual(await scanVerifiedSubjects({ ...base(), detector: async () => Array.from({ length: 21 }, (_, i) => bird(i)) }), []);
});

test('aircraft cannot acquire a bird label, track or species', async () => {
  const rows = await scanVerifiedSubjects({
    ...base(), detector: async () => [{ ...bird(20), detection: { ...bird(20).detection, label: 'aeroplane', classId: 4 } }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].evidence.genre, 'aircraft');
  assert.equal(rows[0].evidence.birdScore, undefined);
  assert.equal(rows[0].evidence.manualDecision, 'review');
});
