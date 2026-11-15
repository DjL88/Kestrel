import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPhotoEdit, DEFAULT_EDIT } from './photoEdits';

test('as-shot settings preserve source pixels exactly', () => {
  const source = new Uint8ClampedArray([20, 130, 243, 128, 255, 80, 0, 255]);
  const pixels = new Uint8ClampedArray(source);
  applyPhotoEdit(pixels, DEFAULT_EDIT);
  assert.deepEqual(pixels, source);
});

test('light adjusts neutral pixels without adding a colour cast', () => {
  const pixels = new Uint8ClampedArray([100, 100, 100, 128]);
  applyPhotoEdit(pixels, { ...DEFAULT_EDIT, exposure: 1 });
  assert.ok(pixels[0] > 100);
  assert.equal(pixels[0], pixels[1]);
  assert.equal(pixels[0], pixels[2]);
  assert.equal(pixels[3], 128);
});

test('warmth changes red and blue in opposite directions', () => {
  const pixels = new Uint8ClampedArray([100, 100, 100, 255]);
  applyPhotoEdit(pixels, { ...DEFAULT_EDIT, warmth: 1 });
  assert.ok(pixels[0] > 100);
  assert.equal(pixels[1], 100);
  assert.ok(pixels[2] < 100);
});

test('new tone controls keep legacy recipes neutral and adjust different tonal ranges', () => {
  const grey = new Uint8ClampedArray([64, 64, 64, 255, 216, 216, 216, 255]);
  const legacy = { exposure: 0, warmth: 0, colour: 0 };
  const unchanged = grey.slice();
  applyPhotoEdit(unchanged, legacy);
  assert.deepEqual(unchanged, grey);
  const lifted = grey.slice();
  applyPhotoEdit(lifted, { ...legacy, shadows: 2 });
  assert.ok(lifted[0] - grey[0] > lifted[4] - grey[4]);
  const recovered = grey.slice();
  applyPhotoEdit(recovered, { ...legacy, highlights: -2 });
  assert.ok(grey[4] - recovered[4] > grey[0] - recovered[0]);
  const contrasted = grey.slice();
  applyPhotoEdit(contrasted, { ...legacy, contrast: 2 });
  assert.ok(contrasted[0] < grey[0] && contrasted[4] > grey[4]);
});
