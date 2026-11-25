import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveUpscaleOutputSize } from './studioMath';
import { originalExportSize } from '../../engineClient/exportOps';

// The canvas asks for Original at its own size times the Output scale, exactly as the Original export does.
const crop = { zoom: 1, insetTop: 0, insetRight: 0, insetBottom: 0, insetLeft: 0 };
const picture = { width: 6000, height: 4000 };
const LIMIT = 400_000_000;

test('Original asked for at 2× doubles and reports the 2× scale', () => {
  const requested = originalExportSize(picture, 2, 1, undefined);
  const out = effectiveUpscaleOutputSize({ ...requested, crop }, picture, 2, LIMIT);
  assert.deepEqual([out.width, out.height, out.factor, out.capped], [12000, 8000, 2, false]);
});

test('a device that cannot hold the doubled picture keeps the real size, reports the cap and no scale', () => {
  const requested = originalExportSize(picture, 2, 1, undefined);
  const out = effectiveUpscaleOutputSize({ ...requested, crop }, picture, 2, 50_000_000);
  assert.deepEqual([out.width, out.height, out.factor, out.capped], [6000, 4000, 1, true]);
});

test('Original export size follows the scale and stays under the longest-edge limit', () => {
  assert.deepEqual(originalExportSize(picture, 2, 1, undefined), { width: 12000, height: 8000 });
  assert.deepEqual(originalExportSize(picture, undefined, 1, undefined), picture);
  assert.deepEqual(originalExportSize(picture, 2, 1, 3000), { width: 3000, height: 2000 });
  assert.deepEqual(originalExportSize({ width: 3000, height: 2000 }, 1, 2, 3000), { width: 1500, height: 1000 });
});
