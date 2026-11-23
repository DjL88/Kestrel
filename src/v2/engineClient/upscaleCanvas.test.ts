import assert from 'node:assert/strict';
import test from 'node:test';
import { upscaleFactorFor } from './upscaleCanvas.ts';

test('upscale applies only when chosen, when the size needs more pixels, and when the canvas fits the device', () => {
  assert.equal(upscaleFactorFor(undefined, 2, 1000, 800, 1e8), 1);
  assert.equal(upscaleFactorFor(1, 2, 1000, 800, 1e8), 1);
  assert.equal(upscaleFactorFor(2, 0.9, 1000, 800, 1e8), 1, 'a size the picture already fills is never enlarged');
  assert.equal(upscaleFactorFor(2, 1.5, 1000, 800, 1e8), 2);
  assert.equal(upscaleFactorFor(4, 3, 1000, 800, 1e8), 4);
  assert.equal(upscaleFactorFor(4, 3, 1000, 800, 5e6), 1, 'too big for this device: not done, and the export caps as before');
});
