import assert from 'node:assert/strict';
import test from 'node:test';
import { maxZoomFor, percentFor, stepZoom, zoomForPercent } from './zoomControls.ts';

test('a big photo in a small window can be zoomed to at least 400% of its pixels, where it was stuck before', () => {
  // 8256 px wide in a 1000 px window: fit is about 12%.
  const fit = 1000 / 8256;
  assert.ok(maxZoomFor(fit, 1) > 30, `max is ${maxZoomFor(fit, 1)}`);
  assert.equal(percentFor(maxZoomFor(fit, 1), fit, 1), 400);
  // The old limit was 6 times fit, only about 73% of actual pixels here.
  assert.equal(percentFor(6, fit, 1), 73);
});

test('a small photo keeps at least the old zoom range, and bad numbers fall back safely', () => {
  assert.equal(maxZoomFor(1.5, 1), 6);
  assert.equal(maxZoomFor(0, 1), 6);
  assert.equal(maxZoomFor(0.5, 0), 6);
});

test('100% means one photo pixel for each screen pixel, so it takes more zoom on a high-density screen', () => {
  const fit = 0.25;
  assert.equal(zoomForPercent(100, fit, 1), 4);
  assert.equal(zoomForPercent(100, fit, 2), 2);
  assert.equal(percentFor(zoomForPercent(200, fit, 2), fit, 2), 200);
});

test('steps go by half again and stop at fit and at the most allowed', () => {
  assert.equal(stepZoom(1, 1, 10), 1.5);
  assert.equal(stepZoom(1.5, 1, 10), 2.25);
  assert.equal(stepZoom(8, 1, 10), 10);
  assert.equal(stepZoom(10, 1, 10), 10);
  assert.equal(stepZoom(1.5, -1, 10), 1);
  assert.equal(stepZoom(1, -1, 10), 1);
  assert.equal(stepZoom(1.2, -1, 10), 1, 'a step that would land almost at fit lands on fit');
});
