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

const pixels = (...rgb: [number, number, number][]) => Uint8ClampedArray.from(rgb.flatMap(([r, g, b]) => [r, g, b, 255]));

test('clipping is also measured per channel, so it can be said in words without relying on colour', () => {
  // Four pixels: one red highlight clipped, one blue shadow clipped, two clean mid-tones.
  const h = toPhotoHistogram(pixels([255, 120, 90], [80, 70, 0], [128, 128, 128], [64, 96, 140]));
  assert.deepEqual(h.channelClip, {
    red: { shadow: 0, highlight: 0.25 },
    green: { shadow: 0, highlight: 0 },
    blue: { shadow: 0.25, highlight: 0 },
  });
  // The overall figures still count a pixel once, whichever channel clipped.
  assert.equal(h.highlightClip, 0.25);
  assert.equal(h.shadowClip, 0.25);
});

test('an empty picture reports no channel clipping rather than dividing by zero', () => {
  const none = { shadow: 0, highlight: 0 };
  assert.deepEqual(toPhotoHistogram(new Uint8ClampedArray(0)).channelClip, { red: none, green: none, blue: none });
});

test('a 16-bit histogram says it is 16-bit and does not call near-white clipped', async () => {
  const { toPhotoHistogram16 } = await import('./histogram.ts');
  const near = new Uint16Array(300).fill(65400);
  const h = toPhotoHistogram16(near);
  assert.equal(h.precision, 'rgb16');
  assert.equal(h.highlightClip, 0);
  assert.equal(h.channelClip?.red.highlight, 0);
  const white = toPhotoHistogram16(new Uint16Array(300).fill(65535));
  assert.equal(white.highlightClip, 1);
  assert.equal(white.channelClip?.blue.highlight, 1);
  assert.equal(toPhotoHistogram(solid(128, 128, 128)).precision, undefined);
});
