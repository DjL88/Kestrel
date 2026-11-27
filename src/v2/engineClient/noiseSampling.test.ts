import assert from 'node:assert/strict';
import test from 'node:test';
import { measureBackgroundNoise } from '../../core/noiseEstimate';
import { mosaicExclusion, noiseLayout, NOISE_GRID } from './noiseSampling';

test('a large picture is sampled by a grid of 16 px-aligned crops spread across the whole frame, inside the picture', () => {
  const layout = noiseLayout(6000, 4000)!;
  assert.equal(layout.cols, NOISE_GRID);
  assert.equal(layout.tiles.length, NOISE_GRID * NOISE_GRID);
  assert.equal(layout.tileWidth % 16, 0);
  for (const { sx, sy } of layout.tiles) {
    assert.ok(sx >= 0 && sy >= 0 && sx + layout.tileWidth <= 6000 && sy + layout.tileHeight <= 4000);
  }
  const xs = layout.tiles.map((tile) => tile.sx);
  assert.ok(Math.min(...xs) < 6000 * 0.2 && Math.max(...xs) > 6000 * 0.6, 'crops reach the sides, not only the centre');
});

test('a small picture is read whole, and one too small is not measured', () => {
  const small = noiseLayout(200, 150)!;
  assert.deepEqual([small.tileWidth, small.tileHeight, small.cols, small.rows, small.tiles.length], [200, 150, 1, 1, 1]);
  assert.equal(noiseLayout(40, 500), null);
  assert.equal(noiseLayout(Number.NaN, 500), null);
});

test('the subject map is looked up at the same place in the smaller subject, crop by crop', () => {
  // Full size 2000 x 1000; the subject was found on a 200 x 100 working copy and covers its right half.
  const alpha = new Float32Array(200 * 100);
  for (let y = 0; y < 100; y += 1) for (let x = 100; x < 200; x += 1) alpha[y * 200 + x] = 1;
  const layout = noiseLayout(2000, 1000)!;
  const exclude = mosaicExclusion(layout, 2000, 1000, { alpha, width: 200, height: 100 });
  const mosaicWidth = layout.tileWidth * layout.cols;
  assert.equal(exclude.length, mosaicWidth * layout.tileHeight * layout.rows);
  layout.tiles.forEach(({ sx }, index) => {
    const left = (index % layout.cols) * layout.tileWidth;
    const midRow = Math.floor(index / layout.cols) * layout.tileHeight + 5;
    const first = exclude[midRow * mosaicWidth + left];
    const last = exclude[midRow * mosaicWidth + left + layout.tileWidth - 1];
    // A crop wholly in the left half is background; wholly in the right half is subject.
    if (sx + layout.tileWidth <= 1000) assert.equal(first + last, 0, `crop ${index} is background`);
    if (sx >= 1000) assert.equal(first + last, 2, `crop ${index} is subject`);
  });
});

test('left out of a mosaic, the subject no longer hides the noise in the background', () => {
  // A mosaic of one 256 px crop: noisy left half (background), perfectly flat right half (subject).
  const size = 256;
  const rgba = new Uint8ClampedArray(size * size * 4);
  let state = 5;
  const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return (state + 0.5) / 4294967296; };
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const noise = x < 96 ? 7 * Math.sqrt(-2 * Math.log(rand())) * Math.cos(2 * Math.PI * rand()) : 0;
    const i = (y * size + x) * 4;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = 120 + noise; rgba[i + 3] = 255;
  }
  const alpha = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) for (let x = 96; x < size; x += 1) alpha[y * size + x] = 1;
  const layout = { tileWidth: size, tileHeight: size, cols: 1, rows: 1, tiles: [{ sx: 0, sy: 0 }] };
  const exclude = mosaicExclusion(layout, size, size, { alpha, width: size, height: size });
  const withSubject = measureBackgroundNoise(rgba, size, size).sigma!;
  const without = measureBackgroundNoise(rgba, size, size, exclude);
  assert.ok(withSubject < 1, `the flat subject sets a clean reading: ${withSubject.toFixed(2)}`);
  assert.equal(without.subjectLeftOut, true);
  assert.ok(Math.abs(without.sigma! - 7) / 7 < 0.25, `background noise 7, measured ${without.sigma!.toFixed(2)}`);
});
