import assert from 'node:assert/strict';
import test from 'node:test';
import { nextCanvasZoom, trackpadZoomFactor, zoomAnchorScroll } from './canvasTrackpadZoom.ts';

test('pinch apart zooms in, pinch together zooms out, normal zero delta is unchanged', () => {
  assert.ok(nextCanvasZoom(1, -30) > 1);
  assert.ok(nextCanvasZoom(1, 30) < 1);
  assert.equal(nextCanvasZoom(1, 0), 1);
});
test('wheel delta modes and extreme values are bounded', () => {
  assert.ok(trackpadZoomFactor(2, 1) < 1);
  assert.equal(nextCanvasZoom(8, -5000), 8);
  assert.equal(nextCanvasZoom(0.25, 5000), 0.25);
  assert.equal(nextCanvasZoom(1, Number.NaN), 1);
});
test('zoom preserves gesture centre in scroll coordinates', () => {
  assert.equal(zoomAnchorScroll(100, 50, 1, 2), 250);
  assert.equal(zoomAnchorScroll(100, 50, 2, 1), 25);
  assert.equal(zoomAnchorScroll(0, 0, 1, 2), 0);
});
