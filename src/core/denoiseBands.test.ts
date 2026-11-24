import assert from 'node:assert/strict';
import test from 'node:test';
import { denoiseBands, denoiseHalo, originalDenoiseStrips } from './denoiseBands.ts';
import { applyNoiseReduction } from './noiseReduction.ts';
import { DEFAULT_EDIT } from './photoEdits.ts';
import { applyMasks, fullContext } from './masks.ts';
import { createSubjectMask, type Mask } from './maskTypes.ts';

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

test('overlapping individual overrides reproduce full-frame pixels even with one-row strips', () => {
  const width = 32, height = 29, stride = width * 4;
  const original = new Uint8ClampedArray(stride * height);
  for (let i = 0; i < original.length; i += 4) {
    original[i] = 100 + (i * 13 % 47);
    original[i + 1] = 110 + (i * 7 % 29);
    original[i + 2] = 95 + (i * 11 % 59);
    original[i + 3] = 255;
  }
  const grid = (fn: (x: number, y: number) => number) => ({
    w: 8, h: 8, data: btoa(String.fromCharCode(...Array.from({length: 64}, (_, i) => fn(i % 8, Math.floor(i / 8))))),
  });
  const group = createSubjectMask('auto-denoise-test', grid((x, y) => x > 0 && y > 0 ? 255 : 0), 'k', 'high');
  group.edit.denoise = 0.4;
  const bg: Mask = { ...group, id: group.id + '-background', invert: true, edit: { denoise: 1.6 } };
  const a: Mask = { ...group, id: group.id + '-instance-1-dog', grid: grid(x => x < 5 ? 255 : 0), edit: { denoise: 0 } };
  const b: Mask = { ...group, id: group.id + '-instance-2-dog', grid: grid(x => x > 2 ? 255 : 0), edit: { denoise: 1.2 } };
  const masks = [a, b, bg, group];
  const context = fullContext(width, height);
  const expected = original.slice();
  applyMasks(expected, width, height, masks, context);
  assert.notDeepEqual(expected, original);
  const actual = original.slice();
  for (const {band, pixels} of originalDenoiseStrips(width, height, denoiseHalo(masks),
    band => ({data: actual.slice(band.start * stride, (band.start + band.height) * stride)}), width)) {
    applyMasks(pixels.data, width, band.height, masks, {
      ...context, view: { x: 0, y: band.start / height, w: 1, h: band.height / height },
    });
    actual.set(pixels.data.subarray((band.y - band.start) * stride, (band.y - band.start + band.rows) * stride), band.y * stride);
  }
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) <= 1, 'strip parity at byte ' + i);
});
