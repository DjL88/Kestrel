import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureMaskBoundary16, type BoundaryPair16 } from './maskBoundaryMetrics16';
const black = [0, 0, 0] as const, white = [65535, 65535, 65535] as const;
test('preserves naturally high-contrast bird against sky when edit does not change edge', () => {
  const edge: BoundaryPair16 = { beforeInside: black, beforeOutside: white, afterInside: black, afterOutside: white };
  const result = measureMaskBoundary16([edge]);
  assert.equal(result.maxExcessLuminanceJump, 0);
  assert.equal(result.largeDiscontinuityFraction, 0);
});
test('detects new hard brightness edge from an edit without pretending species accuracy', () => {
  const mid = [32768, 32768, 32768] as const;
  const result = measureMaskBoundary16([{ beforeInside: mid, beforeOutside: mid, afterInside: white, afterOutside: mid }]);
  assert.ok(result.maxExcessLuminanceJump > 0.7);
  assert.equal(result.largeDiscontinuityFraction, 1);
});
test('detects new hue discontinuity in neutral region', () => {
  const mid = [32768, 32768, 32768] as const;
  const red = [65535, 0, 0] as const;
  const result = measureMaskBoundary16([{ beforeInside: mid, beforeOutside: mid, afterInside: red, afterOutside: mid }]);
  assert.ok(result.maxExcessChromaJump > 0.2);
});
test('rejects corrupt samples rather than producing false metrics', () => {
  assert.throws(() => measureMaskBoundary16([]), RangeError);
  assert.throws(() => measureMaskBoundary16([{ beforeInside: [NaN, 0, 0], beforeOutside: black, afterInside: black, afterOutside: black }]), RangeError);
});
