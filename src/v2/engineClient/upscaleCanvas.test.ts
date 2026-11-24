import assert from 'node:assert/strict';
import test from 'node:test';
import { upscaleFactorFor } from './upscaleCanvas.ts';
import { effectiveUpscaleOutputSize } from '../ui/utils/studioMath.ts';

test('upscale applies only when chosen, when the size needs more pixels, and when the canvas fits the device', () => {
  assert.equal(upscaleFactorFor(undefined, 2, 1000, 800, 1e8), 1);
  assert.equal(upscaleFactorFor(1, 2, 1000, 800, 1e8), 1);
  assert.equal(upscaleFactorFor(2, 0.9, 1000, 800, 1e8), 1, 'a size the picture already fills is never enlarged');
  assert.equal(upscaleFactorFor(2, 1.5, 1000, 800, 1e8), 2);
  assert.equal(upscaleFactorFor(4, 3, 1000, 800, 1e8), 4);
  assert.equal(upscaleFactorFor(4, 3, 1000, 800, 5e6), 1, 'too big for this device: not done, and the export caps as before');
});


test('canvas and export share actual requested dimensions and admitted scale', () => {
  const source = { width: 400, height: 200 };
  const format = { width: 800, height: 400 };
  const plain = effectiveUpscaleOutputSize(format, source, 1, 1e8);
  assert.deepEqual([plain.width, plain.height, plain.capped, plain.factor], [400, 200, true, 1]);
  const doubled = effectiveUpscaleOutputSize(format, source, 2, 1e8);
  assert.deepEqual([doubled.width, doubled.height, doubled.capped, doubled.factor], [800, 400, false, 2]);
  const limited = effectiveUpscaleOutputSize(format, source, 2, 100000);
  assert.deepEqual([limited.width, limited.height, limited.capped, limited.factor], [400, 200, true, 1]);
  const fixed = effectiveUpscaleOutputSize({ width: 200, height: 100 }, source, 4, 1e8);
  assert.deepEqual([fixed.width, fixed.height, fixed.factor], [200, 100, 1]);
  assert.equal(effectiveUpscaleOutputSize(format, undefined, 4, 1e8).factor, 1);
});
