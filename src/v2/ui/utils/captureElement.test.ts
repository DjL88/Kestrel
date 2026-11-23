import test from 'node:test';
import assert from 'node:assert/strict';
import { captureScale, screenshotName } from './captureElement.ts';

test('the scale is at least 2x, at most 4x, and never makes the picture longer than the cap', () => {
  assert.equal(captureScale(1000, 600, 1), 2);
  assert.equal(captureScale(1000, 600, 3), 3);
  assert.equal(captureScale(1000, 600, 9), 4);
  assert.equal(captureScale(4000, 2000, 1), 1.2);
  assert.equal(captureScale(10000, 100, 2), 1);
});

test('the file name is safe and says when it was taken', () => {
  const at = new Date('2026-11-23T08:09:10Z');
  assert.equal(screenshotName('Bird at dusk (sample).webp', at), 'inflight-screenshot-Bird-at-dusk-sample-2026-11-23-08-09-10.png');
  assert.equal(screenshotName('../../x/..', at), 'inflight-screenshot-x-2026-11-23-08-09-10.png');
  assert.equal(screenshotName('', at), 'inflight-screenshot-photo-2026-11-23-08-09-10.png');
});
