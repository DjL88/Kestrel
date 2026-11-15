import test from 'node:test';
import assert from 'node:assert/strict';
import { cropRectangle, DEFAULT_FRAMING, detailAnchor } from './photoFraming';

test('a crop stays inside the source even when the anchor is off-centre', () => {
  assert.deepEqual(cropRectangle(1200, 800, { ...DEFAULT_FRAMING, ratio: 1, x: 0.9 }), {
    x: 400, y: 0, width: 800, height: 800,
  });
  assert.deepEqual(cropRectangle(800, 1200, DEFAULT_FRAMING), { x: 0, y: 0, width: 800, height: 1200 });
});

test('local crop anchor defaults to the centre for a flat image', () => {
  assert.deepEqual(detailAnchor(new Uint8ClampedArray(64 * 64 * 4).fill(128), 64, 64), { x: 0.5, y: 0.5 });
});
