import assert from 'node:assert/strict';
import test from 'node:test';
import { focusZoomCeiling, rebaseZoomForFit, isMouseWheelNotch, keyboardZoomTarget, maxCanvasZoom, mouseWheelZoom, nextCanvasZoom, trackpadZoomFactor, zoomAnchorScroll } from './canvasTrackpadZoom.ts';

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

test('a mouse wheel notch is told apart from a trackpad scroll', () => {
  assert.equal(isMouseWheelNotch({ deltaX: 0, deltaY: 3, deltaMode: 1 }), true); // Firefox, in lines
  assert.equal(isMouseWheelNotch({ deltaX: 0, deltaY: 100, deltaMode: 0, wheelDeltaY: -120 }), true); // Chromium on Windows
  assert.equal(isMouseWheelNotch({ deltaX: 0, deltaY: 4, deltaMode: 0, wheelDeltaY: 240 }), true); // two notches at once
  assert.equal(isMouseWheelNotch({ deltaX: 0, deltaY: 7.5, deltaMode: 0, wheelDeltaY: -9 }), false); // trackpad
  assert.equal(isMouseWheelNotch({ deltaX: 1, deltaY: 100, deltaMode: 0, wheelDeltaY: -120 }), false); // sideways too
  assert.equal(isMouseWheelNotch({ deltaX: 0, deltaY: 0, deltaMode: 1 }), false);
  assert.equal(isMouseWheelNotch({ deltaX: 0, deltaY: 12, deltaMode: 0 }), false); // no legacy delta: assume trackpad
});

test('a mouse wheel notch zooms by the zoom bar step, within 0.25 to 8', () => {
  assert.equal(mouseWheelZoom(1, -100), 1.25);
  assert.equal(mouseWheelZoom(1, 100), 0.8);
  assert.equal(mouseWheelZoom(7.9, -100), 8);
  assert.equal(mouseWheelZoom(0.26, 100), 0.25);
  assert.equal(mouseWheelZoom(2, 0), 2);
});

test('the zoom limit always reaches 100% of the photo, and 400% past it, never less than 8× Fit', () => {
  // A 45 MP Z8 photo (8,256 px across) fitted 507 px wide needs about 16.3× Fit for 100%.
  const fit = 505 / 8256;
  assert.ok(maxCanvasZoom(fit) >= 1 / fit);
  assert.equal(maxCanvasZoom(fit), 4 / fit);
  assert.equal(maxCanvasZoom(0.9), 8);
  assert.equal(maxCanvasZoom(null), 8);
  assert.equal(nextCanvasZoom(15, -120, 0, maxCanvasZoom(fit)) > 16, true);
  assert.equal(keyboardZoomTarget('in', 40, fit, maxCanvasZoom(fit)), 50);
});

test('focusZoomCeiling: one photo pixel per device pixel, never past 100% of the photo, never below Fit', () => {
  // 8280 px photo, Fit shows it at 25.2%: on a 2x display the ceiling is 50% of the photo, not 403%.
  const fit = 0.252;
  assert.ok(Math.abs(focusZoomCeiling(fit, 2) * fit - 0.5) < 1e-9);
  assert.ok(Math.abs(focusZoomCeiling(fit, 1) * fit - 1) < 1e-9);
  assert.ok(Math.abs(focusZoomCeiling(fit, 3) * fit - 1 / 3) < 1e-9);
  assert.equal(focusZoomCeiling(1, 2), 1); // already past the ceiling at Fit
  assert.equal(focusZoomCeiling(null, 2), 2);
  assert.equal(focusZoomCeiling(0.252, Number.NaN) * 0.252 <= 1 + 1e-9, true);
});

test('rebaseZoomForFit: the same share of photo pixels after the true size arrives', () => {
  // 100% at a 1656 px preview's Fit (0.66), then the 8280 px size arrives (Fit 0.132): 100% is 5x as much zoom.
  const zoom = 1 / 0.66;
  const rebased = rebaseZoomForFit(zoom, 0.66, 0.132);
  assert.ok(Math.abs(rebased * 0.132 - 1) < 1e-9);
  assert.equal(rebaseZoomForFit(2, 0, 1), 2);
});
