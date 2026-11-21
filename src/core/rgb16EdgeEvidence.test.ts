import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureRgb16MaskEdge } from './rgb16EdgeEvidence';
import { blendLinearToSrgb16 } from './linearRgb16';

test('bird/sky proxy: boundary metrics compare edited to original, not natural contrast', () => {
  const original = new Uint16Array([9000, 9000, 9000, 60000, 60000, 60000, 9000, 9000, 9000]);
  const unchanged = measureRgb16MaskEdge(original, original, new Float32Array([1, 0.5, 0]));
  assert.equal(unchanged.transitionPixels, 1);
  assert.equal(unchanged.maxBoundaryLuminanceDelta, 0);
  assert.equal(unchanged.newClipFraction, 0);
});
test('skin/foliage proxies: stronger local edge change yields measured signal', () => {
  const original = new Uint16Array([30000, 23000, 17000, 10000, 28000, 10000, 15000, 30000, 55000]);
  const edited = new Uint16Array([31000, 24000, 18000, 65535, 50000, 10000, 15000, 30000, 55000]);
  const result = measureRgb16MaskEdge(original, edited, new Float32Array([1, 0.5, 0]));
  assert.equal(result.status, 'measured');
  assert.equal(result.newClipFraction, 1);
  assert.ok((result.meanBoundaryLuminanceDelta ?? 0) > 0);
  assert.ok((result.meanBoundaryChromaDelta ?? 0) > 0);
  assert.ok((result.meanInteriorLuminanceDelta ?? 0) > 0);
});
test('no boundary means no invented measurement', () => {
  const rgb = new Uint16Array([100, 200, 300]);
  const r = measureRgb16MaskEdge(rgb, rgb, new Float32Array([1]));
  assert.equal(r.status, 'insufficient-boundary');
  assert.equal(r.meanBoundaryChromaDelta, null);
});
test('rejects malformed and nonfinite coverage before publishing evidence', () => {
  const rgb = new Uint16Array([100, 200, 300]);
  assert.throws(() => measureRgb16MaskEdge(rgb, rgb, new Float32Array([Number.NaN])), RangeError);
  assert.throws(() => measureRgb16MaskEdge(rgb, new Uint16Array(0), new Float32Array([0.5])), RangeError);
  assert.throws(() => blendLinearToSrgb16(100, Number.NaN, 0.5), RangeError);
  assert.throws(() => blendLinearToSrgb16(100, 0.4, Number.POSITIVE_INFINITY), RangeError);
});
