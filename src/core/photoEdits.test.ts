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

const pixel = (value: number, edit: Partial<typeof DEFAULT_EDIT>) => {
  const pixels = new Uint8ClampedArray([value, value, value, 255]);
  applyPhotoEdit(pixels, { ...DEFAULT_EDIT, ...edit });
  return pixels[0];
};

test('shadows lift dark tones far more than bright ones', () => {
  assert.ok(pixel(40, { shadows: 2 }) - 40 > 3 * (pixel(220, { shadows: 2 }) - 220));
});

test('highlights recovery darkens bright tones and leaves dark tones', () => {
  assert.ok(pixel(230, { highlights: -2 }) < 230);
  assert.ok(Math.abs(pixel(30, { highlights: -2 }) - 30) <= 1);
});

test('contrast spreads tones around mid grey and keeps neutrals neutral', () => {
  assert.ok(pixel(60, { contrast: 1 }) < 60);
  assert.ok(pixel(200, { contrast: 1 }) > 200);
  const pixels = new Uint8ClampedArray([90, 90, 90, 255]);
  applyPhotoEdit(pixels, { ...DEFAULT_EDIT, contrast: 1, shadows: 1, vibrance: 1 });
  assert.equal(pixels[0], pixels[1]);
  assert.equal(pixels[1], pixels[2]);
});

test('whites and blacks move the end points', () => {
  assert.ok(pixel(250, { whites: 2 }) >= 250);
  assert.ok(pixel(8, { blacks: 2 }) > 8);
});

test('vibrance lifts muted colours more than saturated ones', () => {
  const muted = new Uint8ClampedArray([120, 110, 100, 255]);
  const vivid = new Uint8ClampedArray([250, 40, 20, 255]);
  const spread = (p: Uint8ClampedArray) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);
  const before = [spread(muted), spread(vivid)];
  applyPhotoEdit(muted, { ...DEFAULT_EDIT, vibrance: 2 });
  applyPhotoEdit(vivid, { ...DEFAULT_EDIT, vibrance: 2 });
  assert.ok(spread(muted) / before[0] > spread(vivid) / before[1]);
});

import { applyDetail, hasDetail } from './photoEdits';

function edgeImage(size = 64) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const v = x < size / 2 ? 90 : 160;
    pixels.set([v, v, v, 255], (y * size + x) * 4);
  }
  return pixels;
}

test('detail controls on zero leave pixels untouched and report no detail', () => {
  assert.equal(hasDetail(DEFAULT_EDIT), false);
  const pixels = edgeImage();
  const copy = new Uint8ClampedArray(pixels);
  applyDetail(pixels, 64, 64, DEFAULT_EDIT, 64);
  assert.deepEqual(pixels, copy);
});

test('sharpening leaves flat areas alone and steepens an edge', () => {
  const pixels = edgeImage();
  applyDetail(pixels, 64, 64, { ...DEFAULT_EDIT, sharpen: 2 }, 2200);
  const at = (x: number) => pixels[(32 * 64 + x) * 4];
  assert.equal(at(2), 90);
  assert.equal(at(61), 160);
  assert.ok(at(31) < 90, 'dark side of the edge gets darker');
  assert.ok(at(32) > 160, 'bright side of the edge gets brighter');
});

test('negative texture softens an edge', () => {
  const pixels = edgeImage();
  applyDetail(pixels, 64, 64, { ...DEFAULT_EDIT, texture: -2 }, 2200);
  const at = (x: number) => pixels[(32 * 64 + x) * 4];
  assert.ok(at(31) > 90 && at(32) < 160);
});

test('detail never adds a colour cast to grey', () => {
  const pixels = edgeImage();
  applyDetail(pixels, 64, 64, { ...DEFAULT_EDIT, clarity: 2, sharpen: 1 }, 2200);
  for (let i = 0; i < pixels.length; i += 4) assert.equal(pixels[i], pixels[i + 1]);
});

test('Colour -2 produces grayscale pixels while retaining alpha and allowing tonal adjustments', () => {
  const source = new Uint8ClampedArray([210, 95, 35, 123, 20, 200, 110, 255]);
  const mono = new Uint8ClampedArray(source);
  applyPhotoEdit(mono, { ...DEFAULT_EDIT, colour: -2, contrast: 0.5, vibrance: 1.5 });
  for (let index = 0; index < mono.length; index += 4) {
    assert.equal(mono[index], mono[index + 1]);
    assert.equal(mono[index], mono[index + 2]);
    assert.equal(mono[index + 3], source[index + 3]);
  }
  const colour = new Uint8ClampedArray(source);
  applyPhotoEdit(colour, { ...DEFAULT_EDIT, colour: -1.9 });
  assert.notEqual(colour[0], colour[1], 'positions above -2 retain colour');
});
