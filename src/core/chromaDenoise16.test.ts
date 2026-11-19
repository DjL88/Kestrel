import assert from 'node:assert/strict';
import test from 'node:test';
import { denoiseChromaRgb16 } from './chromaDenoise16';
import { denoiseChromaRGBA } from './naturalChromaDenoise';

const make = (width: number, height: number, sample: (x: number, y: number) => [number, number, number]) => {
  const pixels = new Uint16Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    pixels.set(sample(x, y), (y * width + x) * 3);
  }
  return pixels;
};
const luma = (pixels: Uint16Array, i: number) =>
  0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];

test('no-op strength and neutral monochrome detail are preserved precisely', () => {
  const source = make(51, 41, (x, y) => [8000 + x * 500 + y * 9, 8000 + x * 500 + y * 9, 8000 + x * 500 + y * 9]);
  const zero = source.slice();
  denoiseChromaRgb16(zero, 51, 41, 0, 1);
  assert.deepEqual(zero, source);
  const neutral = source.slice();
  denoiseChromaRgb16(neutral, 51, 41, 1, 2);
  assert.deepEqual(neutral, source, 'chroma only: grey feather luminance detail is not blurred');
});

test('real 16-bit chroma noise is reduced while luminance and fine precision remain', () => {
  const width = 64, height = 64;
  const noisy = make(width, height, (x, y) => {
    const colourNoise = ((x * 37 + y * 17) % 3 - 1) * 1800;
    return [24000 + colourNoise, 28000 - colourNoise * 0.2, 32000 - colourNoise * 0.8];
  });
  const result = noisy.slice();
  denoiseChromaRgb16(result, width, height, 1, 1);
  let sourceVar = 0, outputVar = 0;
  for (let y = 10; y < 54; y++) for (let x = 10; x < 54; x++) {
    const i = (y * width + x) * 3;
    sourceVar += Math.abs(noisy[i] - 24000);
    outputVar += Math.abs(result[i] - 24000);
    assert.ok(Math.abs(luma(result, i) - luma(noisy, i)) < 2.1, 'luma structure is preserved');
  }
  assert.ok(outputVar < sourceVar, `colour noise decreases (${outputVar} vs ${sourceVar})`);
  assert.ok(result.some((v) => v % 257 !== 0), '16-bit output was not quantised through an 8-bit path');
});

test('bright boundaries, isolated saturated feathers and arbitrary source buffers are respected', () => {
  const width = 74, height = 48;
  const input = make(width, height, (x, y) => {
    if (x < 37) return [4000 + y * 2, 4100 + y * 2, 4050 + y * 2];
    return [50000 + y * 3, 50500 + y * 3, 50200 + y * 3];
  });
  const source = input.slice();
  denoiseChromaRgb16(input, width, height, 1, 2);
  for (const y of [2, 20, 46]) {
    for (const x of [0, 35, 36, 37, 38, 73]) {
      const i = (y * width + x) * 3;
      assert.ok(Math.abs(luma(input, i) - luma(source, i)) < 2.1);
      assert.ok(Math.abs(input[i] - source[i]) < 40, `brightness border leaked at ${x}/${y}`);
    }
  }
});

test('16-bit denoise matches the visible 8-bit screen recipe within one byte at equal starting precision', () => {
  const width = 48, height = 38;
  const eight = new Uint8ClampedArray(width * height * 4);
  const sixteen = new Uint16Array(width * height * 3);
  for (let p = 0; p < width * height; p++) {
    const value = [(p * 11 + 90) % 256, (p * 7 + 42) % 256, (p * 17 + 65) % 256];
    eight.set([...value, 255], p * 4);
    sixteen.set(value.map((channel) => channel * 257), p * 3);
  }
  for (const radius of [1, 2] as const) {
    const screen = denoiseChromaRGBA(eight, width, height, { strength: 0.62, radius });
    const master = sixteen.slice();
    denoiseChromaRgb16(master, width, height, 0.62, radius);
    for (let p = 0; p < width * height; p++) for (let c = 0; c < 3; c++) {
      const deviation = Math.abs(screen[p * 4 + c] - master[p * 3 + c] / 257);
      assert.ok(deviation <= 1, `preview/master denoise parity at ${p} channel ${c}: ${deviation}`);
    }
  }
});

test('one-row, multiple-row and single-whole-image bands produce identical pixels', () => {
  const width = 130, height = 73;
  const original = make(width, height, (x, y) => {
    const n = ((x * 79 + y * 131) % 13 - 6) * 90;
    return [22000 + x * 40 + n, 24500 + y * 45 - n, 27111 + n / 2];
  });
  for (const radius of [1, 2] as const) {
    const oneRow = original.slice(), shortBand = original.slice(), wholeFrame = original.slice();
    denoiseChromaRgb16(oneRow, width, height, 0.85, radius, 1);
    denoiseChromaRgb16(shortBand, width, height, 0.85, radius, width * 7);
    denoiseChromaRgb16(wholeFrame, width, height, 0.85, radius, width * height);
    assert.deepEqual(oneRow, wholeFrame, `radius ${radius}, no seams at one-row boundaries`);
    assert.deepEqual(shortBand, wholeFrame, `radius ${radius}, no seams at seven-row boundaries`);
  }
});

test('invalid/truncated high-precision images or band configurations fail visibly', () => {
  assert.throws(() => denoiseChromaRgb16(new Uint16Array(2), 2, 1, 1, 1), /dimensions/);
  assert.throws(() => denoiseChromaRgb16(new Uint16Array(24), 2, 4, NaN, 1), /strength/);
  assert.throws(() => denoiseChromaRgb16(new Uint16Array(24), 2, 4, 1, 1, 0), /band/);
  assert.throws(() => denoiseChromaRgb16(new Uint16Array(24), 2, 4, 1, 3 as 1), /strength/);
});
