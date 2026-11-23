import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_VIDEO_ZOOM, patchVideoZoom, readVideoZoom } from './videoZoomOps.ts';

test('a photo with no stored video zoom reads as the default, switched off', () => {
  assert.deepEqual(readVideoZoom(undefined), DEFAULT_VIDEO_ZOOM);
  assert.deepEqual(readVideoZoom('not an object'), DEFAULT_VIDEO_ZOOM);
  assert.equal(DEFAULT_VIDEO_ZOOM.enabled, false);
});

test('patching only changes the given fields and keeps the rest', () => {
  const on = patchVideoZoom(undefined, { enabled: true, focalX: 70 });
  assert.equal(on.enabled, true);
  assert.equal(on.focalX, 70);
  assert.equal(on.focalY, DEFAULT_VIDEO_ZOOM.focalY);
  assert.equal(on.direction, 'in');
  const zoomOut = patchVideoZoom(on, { direction: 'out', durationSec: 10 });
  assert.equal(zoomOut.direction, 'out');
  assert.equal(zoomOut.durationSec, 10);
  assert.equal(zoomOut.enabled, true);
  assert.equal(zoomOut.focalX, 70);
});

test('out-of-range or malformed values are clamped or dropped, never trusted', () => {
  const damaged = readVideoZoom({ enabled: 'yes', focalX: 500, focalY: -40, direction: 'sideways', durationSec: 9999 });
  assert.equal(damaged.enabled, false);
  assert.equal(damaged.focalX, 100);
  assert.equal(damaged.focalY, 0);
  assert.equal(damaged.direction, 'in');
  assert.equal(damaged.durationSec, 60);
});
