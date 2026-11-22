import assert from 'node:assert/strict';
import test from 'node:test';
import { toPhotoHistogram } from './histogram.ts';

const solid = (r: number, g: number, b: number, pixels = 100) => { const d = new Uint8ClampedArray(pixels * 4); for (let i = 0; i < d.length; i += 4) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; } return d; };

test('a flat grey picture has one tall bar in the middle and no clipping', () => {
  const h = toPhotoHistogram(solid(128, 128, 128));
  assert.equal(h.luma.length, 32);
  const peak = h.luma.indexOf(Math.max(...h.luma));
  assert.ok(peak >= 14 && peak <= 17, `peak at ${peak}`);
  assert.equal(h.shadowClip, 0);
  assert.equal(h.highlightClip, 0);
});

test('clipping is the share of pixels at pure black or pure white', () => {
  const white = toPhotoHistogram(solid(255, 255, 255));
  assert.equal(white.highlightClip, 1);
  assert.equal(white.shadowClip, 0);
  const black = toPhotoHistogram(solid(0, 0, 0));
  assert.equal(black.shadowClip, 1);
});

test('a brighter picture moves the histogram to the right (it follows the pixels, not a formula)', () => {
  const dark = toPhotoHistogram(solid(40, 40, 40)), light = toPhotoHistogram(solid(210, 210, 210));
  assert.ok(dark.luma.indexOf(Math.max(...dark.luma)) < light.luma.indexOf(Math.max(...light.luma)));
});
