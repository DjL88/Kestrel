import assert from 'node:assert/strict';
import test from 'node:test';
import { isLowKeyPixels } from './lowKey';

const picture = (fill: (x: number, y: number) => [number, number, number], size = 64) => {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) data.set([...fill(x, y), 255], (y * size + x) * 4);
  return data;
};

test('a lit subject on a dark scene is low-key', () => {
  assert.equal(isLowKeyPixels(picture((x, y) => (x > 46 && y > 46 ? [200, 140, 90] : [8, 10, 9]))), true);
});
test('a dark picture with nothing lit is just underexposed, not low-key', () => {
  assert.equal(isLowKeyPixels(picture((x) => [8 + x / 4, 8 + x / 4, 8 + x / 4])), false);
});
test('ordinary, bright and tiny pictures are not low-key', () => {
  assert.equal(isLowKeyPixels(picture((x) => [60 + x * 2, 60 + x * 2, 60 + x * 2])), false);
  assert.equal(isLowKeyPixels(picture(() => [230, 230, 230])), false);
  assert.equal(isLowKeyPixels(new Uint8ClampedArray(16)), false);
});
