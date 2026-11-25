import assert from 'node:assert/strict';
import test from 'node:test';
import { SAM_MAX_POINTS, bestSamMask, samInput, samMaskSize, samPoints, unionSamMasks, type SamTap } from './efficientSam';
import { EFFICIENTSAM_TI, OPTIONAL_MODELS, optionalModelBytes } from './optionalModels';

test('input is planar 0..1 RGB with no other normalisation (the encoder does that)', () => {
  const rgba = new Uint8ClampedArray([255, 0, 51, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  const out = samInput(rgba, 2);
  assert.deepEqual(Array.from(out.slice(0, 4)), [1, 0, 0, 1]);
  assert.ok(Math.abs(out[8] - 0.2) < 1e-6);
});

test('masks are bounded: a 45 MP photo gives a 1024 px long edge, a small one keeps its size', () => {
  assert.deepEqual(samMaskSize(8256, 5504), { w: 1024, h: 683 });
  assert.deepEqual(samMaskSize(600, 400), { w: 600, h: 400 });
  assert.throws(() => samMaskSize(0, 10), RangeError);
});

const tap = (x: number, add = true): SamTap => ({ x, y: x, add });

test('taps become add (1) and remove (0) points; a box is two corners (2, 3) first', () => {
  const p = samPoints({ taps: [tap(10), tap(20, false)], box: { x: 1, y: 2, w: 30, h: 40 } })!;
  assert.equal(p.count, 4);
  assert.deepEqual(Array.from(p.labels), [2, 3, 1, 0]);
  assert.deepEqual(Array.from(p.coords.slice(0, 4)), [1, 2, 31, 42]);
});

test('nothing to go on gives null: no box and only removing taps', () => {
  assert.equal(samPoints({ taps: [tap(1, false)] }), null);
  assert.equal(samPoints({}), null);
});

test('beyond six points the newest corrections are kept, and a subject never loses its only added tap', () => {
  const many = [tap(1), ...Array.from({ length: 8 }, (_, i) => tap(10 + i, false))];
  const p = samPoints({ taps: many })!;
  assert.equal(p.count, SAM_MAX_POINTS);
  assert.equal(p.labels[0], 1);
  assert.equal(p.coords[0], 1);
  assert.equal(p.coords[(SAM_MAX_POINTS - 1) * 2], 17);
  const withBox = samPoints({ box: { x: 0, y: 0, w: 5, h: 5 }, taps: Array.from({ length: 7 }, (_, i) => tap(i)) })!;
  assert.equal(withBox.count, SAM_MAX_POINTS);
  assert.deepEqual(Array.from(withBox.labels.slice(0, 2)), [2, 3]);
  assert.equal(withBox.coords[4], 3);
});

test('the best-rated candidate is thresholded at logit 0; several subjects stay separate or join as one layer', () => {
  const w = 2; const h = 2;
  const masks = Float32Array.from([-1, -1, -1, -1, 5, -5, 0, -2, 9, 9, 9, 9]);
  const one = bestSamMask(masks, Float32Array.from([0.1, 0.9, 0.5]), w, h);
  assert.deepEqual(Array.from(one.data), [1, 0, 1, 0]);
  assert.equal(one.coverage, 0.5);
  assert.ok(Math.abs(one.score - 0.9) < 1e-6);
  const two = bestSamMask(Float32Array.from([-1, 3, -1, -1]), Float32Array.from([0.7]), w, h);
  const joined = unionSamMasks([one, two])!;
  assert.deepEqual(Array.from(joined.data), [1, 1, 1, 0]);
  assert.ok(Math.abs(joined.score - 0.7) < 1e-6);
  assert.throws(() => bestSamMask(new Float32Array(3), Float32Array.from([1]), w, h));
});

test('the tap-to-select pack is pinned: two files, about 21 MB, Apache-2.0', () => {
  assert.ok(OPTIONAL_MODELS.includes(EFFICIENTSAM_TI));
  assert.deepEqual(Object.keys(EFFICIENTSAM_TI.files), ['encoder', 'decoder']);
  assert.equal(optionalModelBytes(EFFICIENTSAM_TI), 21230396);
  for (const file of Object.values(EFFICIENTSAM_TI.files)) assert.match(file.sha256, /^[0-9a-f]{64}$/);
});
