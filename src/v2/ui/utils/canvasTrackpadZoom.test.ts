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

test('unsupported wheel delta modes cannot change the photograph zoom', () => {
  for (const mode of [-1, 3, Number.NaN, Number.POSITIVE_INFINITY, 0.5]) {
    assert.equal(trackpadZoomFactor(-60, mode), 1);
    assert.equal(nextCanvasZoom(2, -60, mode), 2);
  }
});

test('invalid gesture anchor coordinates never assign non-finite stage scroll', () => {
  assert.equal(zoomAnchorScroll(Number.NaN, 10, 1, 2), 0);
  assert.equal(zoomAnchorScroll(20, Number.POSITIVE_INFINITY, 1, 2), 20);
  assert.equal(zoomAnchorScroll(20, 10, 1, 0), 20);
  assert.equal(zoomAnchorScroll(-20, 10, 1, 2), 0);
});

test('zoom in and out retains the pointer image coordinate when unclamped', () => {
  const original = 180;
  const zoomed = zoomAnchorScroll(original, 120, 1, 1.5);
  assert.equal(zoomAnchorScroll(zoomed, 120, 1.5, 1), original);
});

test('finite extreme anchor arithmetic fails closed instead of producing Infinity', () => {
  assert.equal(zoomAnchorScroll(Number.MAX_VALUE, 100, 0.25, 8), Number.MAX_VALUE);
  assert.equal(zoomAnchorScroll(Number.MAX_VALUE, Number.MAX_VALUE, 1, 2), Number.MAX_VALUE);
  assert.equal(zoomAnchorScroll(42, Number.MAX_VALUE, 0.25, 8), 42);
});

test('zoom keys step like the zoom bar, fit is 1, and 100% toggles back to fit', async () => {
  const { keyboardZoomTarget, isCanvasZoomAction } = await import('./canvasTrackpadZoom');
  assert.equal(keyboardZoomTarget('in', 1, 0.2), 1.25);
  assert.equal(keyboardZoomTarget('out', 1.25, 0.2), 1);
  assert.equal(keyboardZoomTarget('in', 8, 0.2), 8);
  assert.equal(keyboardZoomTarget('out', 0.25, 0.2), 0.25);
  assert.equal(keyboardZoomTarget('fit', 3, 0.2), 1);
  assert.equal(keyboardZoomTarget('actual', 1, 0.2), 5); // 1 / 0.2: one photo pixel per screen pixel
  assert.equal(keyboardZoomTarget('actual', 5, 0.2), 1); // already at 100%: back to fit
  assert.equal(keyboardZoomTarget('actual', 2, null), 1); // size unknown: 100% cannot be worked out, so fit
  assert.equal(keyboardZoomTarget('in', Number.NaN, 0.2), 1.25);
  assert.equal(isCanvasZoomAction('in'), true);
  assert.equal(isCanvasZoomAction('sideways'), false);
});
