import assert from 'node:assert/strict';
import test from 'node:test';
import { cropHandleZoom } from './cropHandleZoom';

test('pulling each handle OUTWARD zooms the picture in', () => {
  const outward = {
    top: [0, -50], bottom: [0, 50], left: [-50, 0], right: [50, 0],
    tl: [-50, -50], tr: [50, -50], bl: [-50, 50], br: [50, 50],
  } as const;
  for (const [side, delta] of Object.entries(outward)) {
    assert.ok(cropHandleZoom(side as keyof typeof outward, delta[0], delta[1], 500, 500, 1.5) > 1.5, side);
  }
});

test('pushing each handle INWARD reduces zoom towards fit', () => {
  const inward = {
    top: [0, 50], bottom: [0, -50], left: [50, 0], right: [-50, 0],
    tl: [50, 50], tr: [-50, 50], bl: [50, -50], br: [-50, -50],
  } as const;
  for (const [side, delta] of Object.entries(inward)) {
    const zoom = cropHandleZoom(side as keyof typeof inward, delta[0], delta[1], 500, 500, 2);
    assert.ok(zoom >= 1 && zoom < 2, side);
  }
});

test('no drag preserves zoom; resizing never reveals picture edges by zooming below fit', () => {
  assert.equal(cropHandleZoom('tl', 0, 0, 600, 400, 2), 2);
  assert.equal(cropHandleZoom('tl', 500, 500, 600, 400, 1), 1);
});

test('outward drag is bounded at the 8x limit and handles bad geometry without NaN', () => {
  assert.equal(cropHandleZoom('br', 800, 800, 500, 500, 7), 8);
  assert.equal(cropHandleZoom('top', 0, NaN, 0, 0, 1.2), 1.2);
});

test('invalid pointer samples and dimensions never change a crop zoom', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(cropHandleZoom('left', value, 0, 500, 500, 2), 2);
    assert.equal(cropHandleZoom('top', 0, value, 500, 500, 2), 2);
    assert.equal(cropHandleZoom('right', 25, 0, value, 500, 2), 2);
    assert.equal(cropHandleZoom('bottom', 0, 25, 500, value, 2), 2);
  }
  assert.equal(cropHandleZoom('br', 20, 20, 0, 500, 2), 2);
  assert.equal(cropHandleZoom('br', 20, 20, 500, -1, 2), 2);
});

test('overflowing normalised pointer coordinates are ignored, not clamped to a false zoom', () => {
  assert.equal(cropHandleZoom('br', 1e308, 1e308, 1e-308, 1e-308, 2), 2);
  assert.equal(cropHandleZoom('tl', -1e308, -1e308, 1e-308, 1e-308, 2), 2);
  assert.equal(cropHandleZoom('br', 1e308, 1e308, 1, 1, 2), 2);
});

test('invalid handle identifiers and limits cannot produce invalid zoom', () => {
  assert.equal(cropHandleZoom('unknown' as 'br', 20, 20, 500, 500, 2), 2);
  assert.equal(cropHandleZoom('br', 0, 0, 500, 500, 9, 4), 4);
  assert.equal(cropHandleZoom('br', 0, 0, 500, 500, NaN, NaN), 1);
});
