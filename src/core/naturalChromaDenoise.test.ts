import assert from 'node:assert/strict';
import { test } from 'node:test';
import { denoiseChromaRGBA } from './naturalChromaDenoise.ts';

const yOf = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const pixel = (image: Uint8ClampedArray, width: number, x: number, y: number) =>
  Array.from(image.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

test('uniform noisy colour improves without changing the reference luminance', () => {
  const size = 40;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const redNoise = (((x * 17 + y * 7) % 5) - 2) * 8;
    const blueNoise = (((x * 7 + y * 13) % 5) - 2) * 8;
    const red = 120 + redNoise;
    const blue = 120 + blueNoise;
    const green = (120 - 0.2126 * red - 0.0722 * blue) / 0.7152;
    data.set([red, green, blue, 255], i);
  }
  const before = new Uint8ClampedArray(data);
  const output = denoiseChromaRGBA(data, size, size, { strength: 1 });
  let originalError = 0, filteredError = 0;
  for (let y = 2; y < size - 2; y++) for (let x = 2; x < size - 2; x++) {
    const i = (y * size + x) * 4;
    originalError += Math.abs(data[i] - 120) + Math.abs(data[i + 2] - 120);
    filteredError += Math.abs(output[i] - 120) + Math.abs(output[i + 2] - 120);
    const p = pixel(output, size, x, y), q = pixel(data, size, x, y);
    assert.ok(Math.abs(yOf(p[0], p[1], p[2]) - yOf(q[0], q[1], q[2])) <= 1.25);
  }
  assert.ok(filteredError < originalError * 0.82, 'colour error ' + filteredError + ' vs ' + originalError);
  assert.deepEqual(data, before, 'original pixels never change');
});

test('sharp isoluminant colour boundary is protected', () => {
  const width = 14, height = 8;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    data.set(x < 7 ? [190, 79, 80, 255] : [80, 114, 80, 255], (y * width + x) * 4);
  }
  const output = denoiseChromaRGBA(data, width, height, { strength: 1, radius: 2 });
  assert.deepEqual(pixel(output, width, 6, 4), pixel(data, width, 6, 4));
  assert.deepEqual(pixel(output, width, 7, 4), pixel(data, width, 7, 4));
});

test('transparent and semitransparent pixels are unchanged and do not contaminate opaque pixels', () => {
  const original = Uint8ClampedArray.from([120, 120, 120, 255, 255, 0, 255, 0, 40, 20, 60, 120]);
  const result = denoiseChromaRGBA(original, 3, 1);
  assert.deepEqual(Array.from(result), Array.from(original));
});

test('strength zero and a single pixel leave byte-for-byte copies', () => {
  const image = Uint8ClampedArray.from([100, 99, 98, 255, 123, 96, 101, 255]);
  const unchanged = denoiseChromaRGBA(image, 2, 1, { strength: 0 });
  assert.deepEqual(unchanged, image);
  assert.notStrictEqual(unchanged, image);
  assert.deepEqual(denoiseChromaRGBA(image.slice(0, 4), 1, 1), image.slice(0, 4));
});

test('bad dimensions or options are rejected safely, without allocating a huge output', () => {
  const input = new Uint8ClampedArray(16);
  for (const [width, height] of [[0, 4], [2, 3], [2.5, 2], [100000, 100000], [-1, 4]]) {
    assert.throws(() => denoiseChromaRGBA(input, width, height), RangeError);
  }
  assert.throws(() => denoiseChromaRGBA(input, 2, 2, { strength: NaN }), RangeError);
  assert.throws(() => denoiseChromaRGBA(input, 2, 2, { radius: 3 as 1 }), RangeError);
  assert.throws(() => denoiseChromaRGBA(input, 2, 2, { strength: -1 }), RangeError);
});

test('deterministic repeated runs, including edge rows/columns', () => {
  const image = Uint8ClampedArray.from({ length: 4 * 13 * 9 }, (_, i) => (i % 4 === 3 ? 255 : (i * 31) % 256));
  assert.deepEqual(denoiseChromaRGBA(image, 13, 9), denoiseChromaRGBA(image, 13, 9));
});
