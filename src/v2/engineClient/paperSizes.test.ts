import assert from 'node:assert/strict';
import test from 'node:test';
import { dimensionPixels, paperDimensions, PAPER_MM } from './paperSizes.ts';

test('ISO sizes are the published A-series dimensions, not approximations', () => {
  assert.deepEqual(PAPER_MM, { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841] });
  assert.deepEqual(paperDimensions('A4', 'portrait'), { width: 210, height: 297 });
  assert.deepEqual(paperDimensions('A4', 'landscape'), { width: 297, height: 210 });
  assert.deepEqual(paperDimensions('A1', 'portrait'), { width: 594, height: 841 });
});

test('physical sizes convert to genuine whole-pixel output at the selected resolution', () => {
  assert.deepEqual(dimensionPixels(210, 297, 'mm', 300), { width: 2480, height: 3508 });
  assert.deepEqual(dimensionPixels(21, 29.7, 'cm', 300), { width: 2480, height: 3508 });
  assert.deepEqual(dimensionPixels(8, 10, 'in', 300), { width: 2400, height: 3000 });
  assert.deepEqual(dimensionPixels(1080, 1350, 'px', 300), { width: 1080, height: 1350 });
});

test('invalid, non-integer pixels and oversized print dimensions fail without silent resizing', () => {
  assert.equal(dimensionPixels(100.25, 200, 'px', 300), undefined);
  assert.equal(dimensionPixels(0, 200, 'mm', 300), undefined);
  assert.equal(dimensionPixels(297, 420, 'mm', 0), undefined);
  assert.equal(dimensionPixels(594, 841, 'mm', 2400), undefined);
  assert.equal(dimensionPixels(Number.NaN, 10, 'in', 300), undefined);
  assert.equal(dimensionPixels(100, 100, 'invalid' as 'mm', 300), undefined);
});

test('orientation swaps a chosen paper canvas, not photograph pixels', () => {
  const portrait = paperDimensions('A3', 'portrait');
  const landscape = paperDimensions('A3', 'landscape');
  assert.deepEqual(landscape, { width: portrait.height, height: portrait.width });
});
