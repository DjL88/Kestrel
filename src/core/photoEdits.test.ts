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
