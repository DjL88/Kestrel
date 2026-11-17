import assert from 'node:assert/strict';
import { test } from 'node:test';
import { denoiseChromaLinearRGB } from './naturalChromaDenoiseLinear.ts';

const luma = (p: ArrayLike<number>) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];

test('reduces scene-linear chroma speckle while preserving original luminance', () => {
  const size = 40;
  const data = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 3;
    const r = 0.18 + (((x * 17 + y * 7) % 5) - 2) * 0.015;
    const b = 0.18 + (((x * 7 + y * 13) % 5) - 2) * 0.015;
    data.set([r, (0.18 - 0.2126 * r - 0.0722 * b) / 0.7152, b], i);
  }
  const before = data.slice();
  const result = denoiseChromaLinearRGB(data, size, size, { strength: 1 });
  let errorBefore = 0, errorAfter = 0;
  for (let y = 2; y < size - 2; y++) for (let x = 2; x < size - 2; x++) {
    const i = (y * size + x) * 3;
    errorBefore += Math.abs(data[i] - 0.18) + Math.abs(data[i + 2] - 0.18);
    errorAfter += Math.abs(result[i] - 0.18) + Math.abs(result[i + 2] - 0.18);
    assert.ok(Math.abs(luma(result.subarray(i, i + 3)) - luma(data.subarray(i, i + 3))) < 1e-6);
  }
  assert.ok(errorAfter < errorBefore * 0.85, 'not enough chroma suppression: ' + errorAfter + '/' + errorBefore);
  assert.deepEqual(data, before);
});

test('does not clip highlight values above display white or change uniform detail', () => {
  const input = Float32Array.from([1.8, 1.5, 1.3, 1.8, 1.5, 1.3, 1.8, 1.5, 1.3]);
  const result = denoiseChromaLinearRGB(input, 3, 1, { strength: 1 });
  assert.deepEqual(result, input);
  assert.ok(result[0] > 1);
  assert.notStrictEqual(result, input);
});

test('does not blur an isoluminant edge and preserves a high-frequency grey boundary', () => {
  const width = 20, height = 10;
  const input = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = x < 10 ? [0.4, 0.1, 0.1] : [0.1, 0.19, 0.1];
    input.set(v, (y * width + x) * 3);
  }
  const result = denoiseChromaLinearRGB(input, width, height, { strength: 1, radius: 2 });
  // Edge-aware chroma weight makes the boundary impenetrable.
  for (const x of [9, 10]) {
    const i = (5 * width + x) * 3;
    assert.deepEqual(result.slice(i, i + 3), input.slice(i, i + 3));
  }
});

test('invalid dimensions and nonfinite data cannot propagate', () => {
  assert.throws(() => denoiseChromaLinearRGB(new Float32Array(6), 3, 1), RangeError);
  assert.throws(() => denoiseChromaLinearRGB(new Float32Array(6), 2, 1, { strength: Infinity }), RangeError);
  assert.throws(() => denoiseChromaLinearRGB(new Float32Array([0, NaN, 0]), 1, 1), RangeError);
});

test('zero strength produces untouched copy and repeated runs are deterministic', () => {
  const input = Float32Array.from([0.2, 0.1, 0.3, 0.25, 0.15, 0.35]);
  const untouched = denoiseChromaLinearRGB(input, 2, 1, { strength: 0 });
  assert.deepEqual(input, untouched);
  assert.notStrictEqual(input, untouched);
  assert.deepEqual(denoiseChromaLinearRGB(input, 2, 1), denoiseChromaLinearRGB(input, 2, 1));
});
