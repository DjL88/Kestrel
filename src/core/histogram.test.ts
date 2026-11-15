import assert from 'node:assert/strict';
import test from 'node:test';
import { computeHistogram, histogramBars } from './histogram';

test('counts channels, luminance and clipping', () => {
  const h = computeHistogram(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255]));
  assert.equal(h.pixels, 3);
  assert.equal(h.luma[0], 1);
  assert.equal(h.luma[255], 1);
  assert.equal(h.luma[128], 1);
  assert.equal(h.red[128], 1);
  assert.ok(Math.abs(h.shadowClip - 1 / 3) < 1e-9);
  assert.ok(Math.abs(h.highlightClip - 1 / 3) < 1e-9);
});

test('an empty image reports no clipping', () => {
  const h = computeHistogram(new Uint8ClampedArray());
  assert.equal(h.shadowClip, 0);
  assert.equal(h.highlightClip, 0);
});

test('bars are normalised and keep the number of bars', () => {
  const bins = new Uint32Array(256);
  bins[10] = 100;
  bins[200] = 4;
  const bars = histogramBars(bins, 64);
  assert.equal(bars.length, 64);
  assert.equal(Math.max(...bars), 1);
  assert.ok(bars[50] > 0 && bars[50] < 1);
});
