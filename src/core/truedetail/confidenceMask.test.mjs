import test from 'node:test';
import assert from 'node:assert/strict';
import { blendConfidenceMask } from './confidenceMask.mjs';
const f = (...xs) => new Float32Array(xs);
test('zero confidence leaves original unchanged', () => {
  assert.deepEqual([...blendConfidenceMask(f(.2,.3,.4,1), f(.9,.9,.9,.5), f(0), f(1))], [...f(.2,.3,.4,1)]);
});
test('full confidence and coverage uses enhanced RGB but original alpha', () => {
  assert.deepEqual([...blendConfidenceMask(f(0,0,0,.7), f(1,1,1,1), f(1), f(1))], [...f(1,1,1,.7)]);
});
test('partial coverage and confidence blend independently', () => {
  const result = blendConfidenceMask(f(0,0,0,1),f(1,1,1,1),f(.5),f(.5),.8);
  assert.ok(Math.abs(result[0] - .2) < 1e-6);
});
test('rejects nonfinite mask, mismatched dimensions and invalid strength', () => {
  assert.throws(() => blendConfidenceMask(f(0,0,0,1),f(1,1,1,1),f(NaN),f(1)), RangeError);
  assert.throws(() => blendConfidenceMask(f(0,0,0,1),f(1,1,1,1),f(1,1),f(1)), RangeError);
  assert.throws(() => blendConfidenceMask(f(0,0,0,1),f(1,1,1,1),f(1),f(1),Infinity), RangeError);
});
test('does not mutate inputs', () => {
  const base=f(.2,.3,.4,1), edited=f(.9,.8,.7,1);
  blendConfidenceMask(base,edited,f(.5),f(.5));
  assert.equal(base[0],f(.2)[0]); assert.equal(edited[0],f(.9)[0]);
});
