import assert from 'node:assert/strict';
import test from 'node:test';
import { assignBurstGroups, createDemoShootState } from './cullingEngine';
import {
  EMBED_MODEL, LOOK_ALIKE_ABOVE, SCENE_CHANGE_BELOW, decodeEmbedding, embeddingCrop, encodeEmbedding, preprocessEmbedding, similarity,
} from './visualSimilarity';
import type { PhotoFrame } from './types';

const unit = (seed: number) => {
  const v = new Float32Array(EMBED_MODEL.dims);
  for (let i = 0; i < v.length; i += 1) v[i] = Math.sin(seed * 31.7 + i * 0.37);
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

test('an embedding survives int8 storage closely enough to keep its neighbours', () => {
  const a = unit(1);
  const stored = encodeEmbedding(a)!;
  assert.equal(stored.model, EMBED_MODEL.id);
  assert.equal(atob(stored.v).length, EMBED_MODEL.dims);
  const back = decodeEmbedding(stored)!;
  assert.ok(similarity(a, back)! > 0.999);
});

test('corrupt output and other models give no similarity evidence', () => {
  const nan = unit(2); nan[5] = Number.NaN;
  assert.equal(encodeEmbedding(nan), null);
  assert.equal(encodeEmbedding(new Float32Array(EMBED_MODEL.dims)), null);
  assert.equal(encodeEmbedding(new Float32Array(10)), null);
  const stored = encodeEmbedding(unit(3))!;
  assert.equal(decodeEmbedding({ ...stored, model: 'other-model' }), null);
  assert.equal(decodeEmbedding({ ...stored, scale: -1 }), null);
  assert.equal(decodeEmbedding({ ...stored, v: '!!not base64' }), null);
  assert.equal(decodeEmbedding({ ...stored, v: btoa('short') }), null);
  assert.equal(decodeEmbedding(undefined), null);
  assert.equal(similarity(null, unit(1)), null);
});

test('preprocessing is planar ImageNet normalisation; the crop is the centre 224/256 square', () => {
  const size = 2;
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255]);
  const out = preprocessEmbedding(rgba, size);
  assert.equal(out.length, 12);
  assert.ok(Math.abs(out[0] - (1 - 0.485) / 0.229) < 1e-6);
  assert.ok(Math.abs(out[4 + 1] - (1 - 0.456) / 0.224) < 1e-6);
  assert.throws(() => preprocessEmbedding(new Uint8ClampedArray(4), size));
  assert.deepEqual(embeddingCrop(400, 256), { x: 88, y: 16, size: 224 });
});

function frames(times: (number | undefined)[]): PhotoFrame[] {
  const base = createDemoShootState(times.length).frames;
  return base.map((frame, i) => ({ ...frame, sequenceIndex: i + 1, exif: { ...frame.exif, capturedAtMs: times[i], camera: 'Z 8' } }));
}

test('without similarity, or with no evidence for a pair, grouping is exactly the time-based result', () => {
  const shoot = frames([1000, 1400, 1800, 9000]);
  const plain = assignBurstGroups(shoot);
  assert.deepEqual(assignBurstGroups(shoot, undefined, () => null).map((f) => f.burstGroupId), plain.map((f) => f.burstGroupId));
  assert.deepEqual(plain.map((f) => f.burstCount), [3, 3, 3, 1]);
});

test('a clear scene change splits a time burst; similar frames stay together', () => {
  const shoot = frames([1000, 1400, 1800, 2200]);
  // Frames 1-2 alike, then the camera swings to something else for 3-4.
  const look = (a: PhotoFrame, b: PhotoFrame) => {
    const pair = [a.sequenceIndex, b.sequenceIndex].sort().join('-');
    return pair === '2-3' ? SCENE_CHANGE_BELOW - 0.1 : 0.85;
  };
  const grouped = assignBurstGroups(shoot, undefined, look);
  assert.deepEqual(grouped.map((f) => f.burstCount), [2, 2, 2, 2]);
  assert.notEqual(grouped[1].burstGroupId, grouped[2].burstGroupId);
});

test('look-alike frames without capture times join; unlike ones and different cameras do not', () => {
  const shoot = frames([undefined, undefined, undefined]);
  const alike = assignBurstGroups(shoot, undefined, () => LOOK_ALIKE_ABOVE + 0.01);
  assert.deepEqual(alike.map((f) => f.burstCount), [3, 3, 3]);
  const unlike = assignBurstGroups(shoot, undefined, () => LOOK_ALIKE_ABOVE - 0.05);
  assert.deepEqual(unlike.map((f) => f.burstGroupId), [null, null, null]);
  const mixed = shoot.map((f, i) => (i === 1 ? { ...f, exif: { ...f.exif, camera: 'Z 5II' } } : f));
  assert.deepEqual(assignBurstGroups(mixed, undefined, () => 0.99).map((f) => f.burstGroupId), [null, null, null]);
});

test('similarity never joins frames that are timed but further apart than the burst gap', () => {
  const shoot = frames([1000, 60000]);
  assert.deepEqual(assignBurstGroups(shoot, undefined, () => 0.99).map((f) => f.burstGroupId), [null, null]);
});

test('regrouping a project uses stored embeddings, writes nothing without evidence, and keeps decisions', async () => {
  const { regroupBurstsWithEmbeddings } = await import('./cullingEngine');
  const shoot = assignBurstGroups(frames([1000, 1400, 1800, 2200])).map((f, i) => ({ ...f, decision: i === 0 ? 'keep' as const : f.decision }));
  assert.equal(regroupBurstsWithEmbeddings(shoot), null, 'no embeddings: nothing changes');
  const a = encodeEmbedding(unit(10))!;
  const b = encodeEmbedding(unit(10).map((x) => -x))!; // a clearly different picture
  const embedded = shoot.map((f, i) => ({ ...f, visualEmbedding: i < 2 ? a : b }));
  const sim = similarity(decodeEmbedding(a), decodeEmbedding(b))!;
  const regrouped = regroupBurstsWithEmbeddings(embedded);
  if (sim < SCENE_CHANGE_BELOW) {
    assert.ok(regrouped);
    assert.deepEqual(regrouped!.map((f) => f.burstCount), [2, 2, 2, 2]);
    assert.equal(regrouped![0].decision, 'keep');
    assert.equal(regroupBurstsWithEmbeddings(regrouped!), null, 'stable: a second pass changes nothing');
  } else {
    assert.equal(regrouped, null);
  }
  const same = shoot.map((f) => ({ ...f, visualEmbedding: a }));
  assert.equal(regroupBurstsWithEmbeddings(same), null, 'one consistent burst: unchanged');
});
