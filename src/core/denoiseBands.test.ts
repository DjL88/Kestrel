import assert from 'node:assert/strict';
import test from 'node:test';
import { denoiseBands } from './denoiseBands.ts';
import { applyNoiseReduction } from './noiseReduction.ts';
import { DEFAULT_EDIT } from './photoEdits.ts';

test('strip planning covers a 45 MP frame with no output overlap', () => {
  const bands = [...denoiseBands(8256, 5504)];
  let y = 0;
  for (const band of bands) {
    assert.equal(band.y, y);
    assert.equal(band.start, Math.max(0, y - 2));
    assert.equal(band.start + band.height, Math.min(5504, y + band.rows + 2));
    assert.ok(band.height * 8256 <= 1_000_000);
    y += band.rows;
  }
  assert.equal(y, 5504);
});

test('original halo rows reproduce the full-frame colour denoise kernel', () => {
  const width = 32, height = 29;
  const source = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < source.length; i += 4) {
    source[i] = 100 + (i * 13 % 47);
    source[i + 1] = 110 + (i * 7 % 29);
    source[i + 2] = 95 + (i * 11 % 59);
    source[i + 3] = 255;
  }
  for (const denoise of [0.8, 1.6]) {
    const edit = { ...DEFAULT_EDIT, denoise };
    const expected = applyNoiseReduction(source, width, height, edit);
    const actual = new Uint8ClampedArray(source.length);
    for (const band of denoiseBands(width, height, width * 9)) {
      const strip = source.slice(band.start * width * 4, (band.start + band.height) * width * 4);
      const filtered = applyNoiseReduction(strip, width, band.height, edit);
      actual.set(filtered.subarray((band.y - band.start) * width * 4, (band.y - band.start + band.rows) * width * 4), band.y * width * 4);
    }
    assert.deepEqual(actual, expected);
  }
});
