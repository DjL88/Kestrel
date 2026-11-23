import assert from 'node:assert/strict';
import test from 'node:test';
import { nextExtendCount, planContinuousExtend, readExtendCount } from './continuousExtend.ts';

test('legacy split projects retain their one/two-section meaning', () => {
  assert.equal(readExtendCount({ splitFrames: true }), 2);
  assert.equal(readExtendCount({ splitFrames: false }), 1);
  assert.equal(readExtendCount({}), 1);
  assert.equal(readExtendCount({ splitFrames: true, extendCount: 4 }), 4);
  assert.equal(readExtendCount({ splitFrames: true, extendCount: 8 }), 2);
});

test('extension stops at five sections', () => {
  assert.equal(nextExtendCount(1), 2);
  assert.equal(nextExtendCount(4), 5);
  assert.equal(nextExtendCount(5), 5);
});

test('one continuous surface has consecutive seam positions and equal export sections', () => {
  const plan = planContinuousExtend(1080, 1350, 3, 6000, 4000);
  assert.equal(plan.totalWidth, 3240);
  assert.equal(plan.totalHeight, 1350);
  assert.deepEqual(plan.sections.map(s => [s.index, s.x, s.width]), [[1, 0, 1080], [2, 1080, 1080], [3, 2160, 1080]]);
  assert.equal(plan.canExportAtRequestedSize, true);
  assert.equal(plan.warning, null);
});

test('insufficient source resolution blocks requested-size export rather than upscaling', () => {
  const plan = planContinuousExtend(1080, 1350, 5, 4000, 3000);
  assert.equal(plan.canExportAtRequestedSize, false);
  assert.equal(plan.maximumNativeScale, 4000 / 5400);
  assert.match(plan.warning!, /will not upscale/);
});

test('invalid dimensions and section counts are refused', () => {
  assert.throws(() => planContinuousExtend(0, 100, 2, 400, 400), RangeError);
  assert.throws(() => planContinuousExtend(100, 100, 6 as never, 400, 400), RangeError);
  assert.throws(() => planContinuousExtend(Number.MAX_SAFE_INTEGER, 100, 2, 400, 400), RangeError);
});
