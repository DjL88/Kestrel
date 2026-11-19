import assert from 'node:assert/strict';
import test from 'node:test';
import { adjustmentFill, signedAdjustment } from './adjustmentSlider';

test('copper track grows away from neutral in either direction', () => {
  assert.deepEqual(adjustmentFill(0, -2, 2), { start: 50, width: 0, neutral: 50, current: 50 });
  assert.deepEqual(adjustmentFill(1, -2, 2), { start: 50, width: 25, neutral: 50, current: 75 });
  assert.deepEqual(adjustmentFill(-1, -2, 2), { start: 25, width: 25, neutral: 50, current: 25 });
});
test('one-way and off-centre ranges preserve true neutral origin', () => {
  assert.deepEqual(adjustmentFill(1, 0, 2), { start: 0, width: 50, neutral: 0, current: 50 });
  assert.deepEqual(adjustmentFill(6, -12, 12, 0), { start: 50, width: 25, neutral: 50, current: 75 });
});
test('out-of-range and invalid inputs cannot overflow the slider', () => {
  assert.deepEqual(adjustmentFill(99, -2, 2), { start: 50, width: 50, neutral: 50, current: 100 });
  assert.deepEqual(adjustmentFill(-99, -2, 2), { start: 0, width: 50, neutral: 50, current: 0 });
  assert.deepEqual(adjustmentFill(NaN, 0, 2), { start: 0, width: 0, neutral: 0, current: 0 });
  assert.deepEqual(adjustmentFill(1, 2, 2), { start: 0, width: 0, neutral: 0, current: 0 });
});
test('display values reflect real recipe precision with a sign', () => {
  assert.equal(signedAdjustment(0), '0');
  assert.equal(signedAdjustment(-0.05), '−0.05');
  assert.equal(signedAdjustment(0.7), '+0.7');
  assert.equal(signedAdjustment(-0.005), '−0.01');
  assert.equal(signedAdjustment(0.004), '0');
  assert.equal(signedAdjustment(NaN), '—');
});
