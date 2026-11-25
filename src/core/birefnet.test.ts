import assert from 'node:assert/strict';
import test from 'node:test';
import { birefnetInput, birefnetMask } from './birefnet';
import { BIREFNET_LITE, OPTIONAL_MODELS, optionalModelFitsDevice } from './optionalModels';

test('input is ImageNet-normalised planar RGB', () => {
  const out = birefnetInput(new Uint8ClampedArray(4).fill(255), 1);
  assert.ok(Math.abs(out[0] - (1 - 0.485) / 0.229) < 1e-6);
  assert.throws(() => birefnetInput(new Uint8ClampedArray(3), 1), RangeError);
});

test('probabilities resample to the mask size; soft edges stay soft, not thresholded', () => {
  const size = 4;
  const raw = Float32Array.from([0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]);
  const same = birefnetMask(raw, 4, 4, size);
  assert.deepEqual(Array.from(same.alpha), Array.from(raw, (v) => v * 255));
  assert.equal(same.coverage, 0.5);
  const half = birefnetMask(raw, 3, 2, size);
  assert.equal(half.alpha.length, 6);
  assert.ok(half.alpha[1] > 0 && half.alpha[1] < 255, 'the middle column is a soft edge');
  assert.ok(half.edgeShare > 0);
});

test('logits are recognised and passed through a sigmoid; non-finite output refuses the mask', () => {
  const m = birefnetMask(Float32Array.from([-20, 20, 0, 20]), 2, 2, 2);
  assert.deepEqual(Array.from(m.alpha), [0, 255, 128, 255]);
  assert.throws(() => birefnetMask(Float32Array.from([0, NaN, 0, 0]), 2, 2, 2), /invalid/);
  assert.throws(() => birefnetMask(new Float32Array(3), 2, 2, 2), /unexpected/);
});

test('the fine-edge pack is desktop-only and MIT', () => {
  assert.ok(OPTIONAL_MODELS.includes(BIREFNET_LITE));
  assert.equal(BIREFNET_LITE.licence, 'MIT');
  assert.equal(optionalModelFitsDevice(BIREFNET_LITE, 'phone'), false);
  assert.equal(optionalModelFitsDevice(BIREFNET_LITE, 'desktop'), true);
  assert.match(BIREFNET_LITE.files.model.sha256, /^[0-9a-f]{64}$/);
});

test('mask comparison: gain is what the fine mask adds, loss what it drops; a different subject keeps the built-in mask', async () => {
  const { compareSubjectMasks, preferFineMask } = await import('./birefnet');
  const coarse = Uint8Array.from([255, 255, 255, 0, 0, 0, 0, 0]);
  const finer = Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 0]); // adds a wing tip
  const same = compareSubjectMasks(coarse, finer);
  assert.equal(same.iou, 0.75);
  assert.equal(same.gain, 0.25);
  assert.equal(same.loss, 0);
  assert.equal(preferFineMask(same), true);
  const elsewhere = compareSubjectMasks(coarse, Uint8Array.from([0, 0, 0, 0, 0, 255, 255, 255]));
  assert.equal(elsewhere.iou, 0);
  assert.equal(preferFineMask(elsewhere), false);
  assert.throws(() => compareSubjectMasks(coarse, new Uint8Array(3)));
});
