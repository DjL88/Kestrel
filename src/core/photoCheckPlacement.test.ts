import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placePhotoInsideSquare } from './photoCheckPlacement';

test('landscape photos keep their 3:2 shape when sent to the local vision model', () => {
  assert.deepEqual(placePhotoInsideSquare(3000, 2000, 512), { x: 0, y: 256 / 3, width: 512, height: 1024 / 3 });
});

test('portrait photos keep their 2:3 shape instead of distorting the subject', () => {
  const box = placePhotoInsideSquare(2000, 3000, 512);
  assert.equal(box.y, 0);
  assert.ok(Math.abs(box.width / box.height - 2 / 3) < 1e-12);
  assert.ok(Math.abs(box.x - (512 - 1024 / 3) / 2) < 1e-12);
});

test('square images fill the model input; invalid dimensions are refused', () => {
  assert.deepEqual(placePhotoInsideSquare(1000, 1000, 512), { x: 0, y: 0, width: 512, height: 512 });
  assert.throws(() => placePhotoInsideSquare(0, 4000, 512), RangeError);
  assert.throws(() => placePhotoInsideSquare(Infinity, 4000, 512), RangeError);
});
