import assert from 'node:assert/strict';
import test from 'node:test';
import { hasWatermark, NO_WATERMARK, watermarkSpots } from './watermark.ts';

test('nothing is drawn until a mark is switched on and has content', () => {
  assert.equal(hasWatermark(undefined), false);
  assert.equal(hasWatermark({ ...NO_WATERMARK, text: 'x' }), false);
  assert.equal(hasWatermark({ ...NO_WATERMARK, on: true, text: '  ' }), false);
  assert.equal(hasWatermark({ ...NO_WATERMARK, on: true, text: '© D' }), true);
  assert.equal(hasWatermark({ ...NO_WATERMARK, on: true, kind: 'image' }), false);
  assert.equal(hasWatermark({ ...NO_WATERMARK, on: true, kind: 'image', imageData: 'data:image/png;base64,AA' }), true);
});

test('corner marks stay inside the picture with an even margin', () => {
  const [spot] = watermarkSpots(1000, 800, 200, 50, 'bottom-right');
  assert.deepEqual(spot, { x: 1000 - 200 - 24, y: 800 - 50 - 24 });
  assert.deepEqual(watermarkSpots(1000, 800, 200, 50, 'top-left')[0], { x: 24, y: 24 });
  assert.deepEqual(watermarkSpots(1000, 800, 200, 50, 'centre')[0], { x: 400, y: 375 });
});

test('tiled marks repeat across the picture', () => {
  const spots = watermarkSpots(1000, 800, 100, 30, 'tiled');
  assert.ok(spots.length > 20);
  assert.ok(spots.every((spot) => spot.x < 1000 && spot.y < 800));
});
