import assert from 'node:assert/strict';
import test from 'node:test';
import { printLayout } from './printLayout.ts';

test('a landscape photo turns the page and fills the width inside the margin', () => {
  const layout = printLayout(6000, 4000, 'A4');
  assert.equal(layout.orientation, 'landscape');
  assert.deepEqual(layout.pageMm, { width: 297, height: 210 });
  assert.ok(Math.abs(layout.imageMm.width - 277) < 0.01);
  assert.ok(Math.abs(layout.imageMm.height - 184.67) < 0.01);
  assert.equal(layout.ppi, 550);
});

test('a tall photo is limited by the height, and a small one prints at fewer ppi, never resampled up', () => {
  const tall = printLayout(1000, 3000, 'A4');
  assert.equal(tall.orientation, 'portrait');
  assert.ok(Math.abs(tall.imageMm.height - 277) < 0.01);
  const small = printLayout(800, 600, 'A3');
  assert.ok(small.ppi < 100);
});

test('a picture with no size is refused', () => {
  assert.throws(() => printLayout(0, 100, 'A4'), RangeError);
});
