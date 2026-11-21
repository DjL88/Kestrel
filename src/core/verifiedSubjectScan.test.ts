import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanVerifiedSubjects, scanVerifiedSubjectDetails, type VerifiedSubjectScan } from './verifiedSubjectScan';

const sha = 'a'.repeat(64);
const identity = { photoId: 'bird-1', sourceSha256: sha, width: 1000, height: 800, modelVersion: 'signed-yolox-v1', burstId: 'folder/burst' };
const bird = (x: number) => ({
  detection: { label: 'bird', classId: 14, score: 0.8, box: { x, y: 100, w: 120, h: 100 } },
  sharpness: 9, coverage: 0.015,
});
const base = (): VerifiedSubjectScan => ({
  source: { width: 1000, height: 800 } as HTMLCanvasElement,
  verifyDecodedSource: async () => ({ sourceSha256: sha, width: 1000, height: 800 }),
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

test('a thumbnail or mismatched input geometry is never passed to the detector', async () => {
  let called = false;
  const rows = await scanVerifiedSubjects({
    ...base(),
    source: { width: 500, height: 400 } as HTMLCanvasElement,
    detector: async () => { called = true; return [bird(20)]; },
  });
  assert.deepEqual(rows, []);
  assert.equal(called, false);
});

test('an untrusted decoded preview cannot borrow the original file digest', async () => {
  let called = false;
  const rows = await scanVerifiedSubjects({
    ...base(),
    verifyDecodedSource: async () => ({ sourceSha256: 'b'.repeat(64), width: 1000, height: 800 }),
    detector: async () => { called = true; return [bird(20)]; },
  });
  assert.deepEqual(rows, []);
  assert.equal(called, false);
});

test('decoded source replacement while the detector is running discards candidates', async () => {
  let reads = 0;
  const rows = await scanVerifiedSubjects({
    ...base(),
    verifyDecodedSource: async () => ({
      sourceSha256: ++reads === 1 ? sha : 'b'.repeat(64), width: 1000, height: 800,
    }),
  });
  assert.deepEqual(rows, []);
  assert.equal(reads, 2);
});

test('a mutable canvas resized during inference cannot return boxes for the old geometry', async () => {
  const source = { width: 1000, height: 800 } as HTMLCanvasElement;
  const rows = await scanVerifiedSubjects({
    ...base(), source,
    detector: async () => { source.width = 400; return [bird(20)]; },
  });
  assert.deepEqual(rows, []);
});

test('class index and label disagreement never turns an aircraft into a bird', async () => {
  const rows = await scanVerifiedSubjects({
    ...base(),
    detector: async () => [{
      ...bird(20), detection: { ...bird(20).detection, classId: 4, label: 'bird' },
    }],
  });
  assert.deepEqual(rows, []);
});

test('overlapping bird and aircraft boxes abstain on genre but preserve manual review', async () => {
  const aircraft = {
    ...bird(20),
    detection: { ...bird(20).detection, label: 'aeroplane', classId: 4, score: 0.7 },
  };
  const rows = await scanVerifiedSubjects({
    ...base(), detector: async () => [bird(20), aircraft],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.evidence.genre), ['unknown', 'unknown']);
  assert.deepEqual(rows.map(r => r.evidence.manualDecision), ['review', 'review']);
  assert.ok(rows.every(r => r.evidence.subjectBox && !r.evidence.subjectTrackId && !r.evidence.eyeBox));
});

test('non-overlapping birds and aircraft retain distinct manual review boxes', async () => {
  const aircraft = {
    ...bird(600),
    detection: { ...bird(600).detection, label: 'aeroplane', classId: 4 },
  };
  const rows = await scanVerifiedSubjects({
    ...base(), detector: async () => [bird(20), aircraft],
  });
  assert.deepEqual(rows.map(r => r.evidence.genre), ['bird', 'aircraft']);
  assert.ok(rows.every(r => r.evidence.manualDecision === 'review'));
});

const detailBase = () => ({
  ...base(),
  raster: {
    photoId: identity.photoId, sourceSha256: sha, width: 1000, height: 800,
    sourceWidth: 1000, sourceHeight: 800, rgba: new Uint8Array(1000 * 800 * 4),
  },
  verifyRaster: async () => true,
});

test('two detector subjects produce separate exact-pixel review crops', async () => {
  const details = await scanVerifiedSubjectDetails(detailBase());
  assert.equal(details.length, 2);
  assert.deepEqual(details.map(d => d.crop.x), [20, 500]);
  assert.deepEqual(details.map(d => d.crop.width), [120, 120]);
  assert.ok(details.every(d => d.candidate.evidence.manualDecision === 'review'));
  assert.ok(details.every(d => d.crop.rgba.byteLength === 120 * 100 * 4));
});

test('unverified source raster is never used for Select detail', async () => {
  let detected = false;
  const rows = await scanVerifiedSubjectDetails({
    ...detailBase(), verifyRaster: async () => false,
    detector: async () => { detected = true; return [bird(20)]; },
  });
  assert.deepEqual(rows, []);
  assert.equal(detected, false);
});

test('raster replaced after detection returns no stale subject pixels', async () => {
  let attested = 0;
  const rows = await scanVerifiedSubjectDetails({
    ...detailBase(), verifyRaster: async () => ++attested === 1,
  });
  assert.deepEqual(rows, []);
  assert.equal(attested, 2);
});

test('insufficient shared crop budget abstains rather than silently dropping subjects', async () => {
  const rows = await scanVerifiedSubjectDetails({ ...detailBase(), maxCropBytes: 120 * 100 * 4 });
  assert.deepEqual(rows, []);
});

test('photo switch during raster attestation discards subject crops', async () => {
  let selected = true;
  const rows = await scanVerifiedSubjectDetails({
    ...detailBase(),
    isCurrent: () => selected,
    verifyRaster: async () => { selected = false; return true; },
  });
  assert.deepEqual(rows, []);
});

test('raster changed during final asynchronous original hash cannot escape as verified detail', async () => {
  let attested = 0;
  let originalReads = 0;
  const rows = await scanVerifiedSubjectDetails({
    ...detailBase(),
    verifyRaster: async () => ++attested < 3,
    verifyOriginalSha256: async () => { originalReads++; return sha; },
  });
  assert.deepEqual(rows, []);
  assert.equal(originalReads, 3);
  assert.equal(attested, 3);
});
