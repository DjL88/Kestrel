import assert from 'node:assert/strict';
import test from 'node:test';
import { approximateSubjectGrid, boxToFractions, ellipseWeight } from './approximateSubject';
import { createSubjectMask, validMasks } from './maskTypes';
import { fullContext, maskAlpha } from './masks';

test('the ellipse is full in the middle, zero at the corners and smooth between', () => {
  assert.equal(ellipseWeight(0.5, 0.5), 1);
  assert.equal(ellipseWeight(0, 0), 0);
  let last = 1;
  for (let u = 0.5; u <= 1; u += 0.01) { const w = ellipseWeight(u, 0.5); assert.ok(w <= last + 1e-9, 'never rises outward'); assert.ok(last - w < 0.1, 'no step'); last = w; }
});

test('a box in pixels becomes fractions inside the frame; a sliver is refused', () => {
  assert.deepEqual(boxToFractions({ x: 100, y: 50, w: 200, h: 100 }, 400, 200), { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  assert.equal(boxToFractions({ x: 0, y: 0, w: 2, h: 100 }, 400, 200), null);
});

test('the area covers the box centre, not the outside, and is a valid subject mask', () => {
  const grid = approximateSubjectGrid({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 0.75);
  const mask = { ...createSubjectMask('a', grid, 'k', 'medium'), approximate: true };
  assert.equal(validMasks([mask]), true);
  const alpha = maskAlpha(mask, 100, 75, fullContext(100, 75));
  assert.ok(alpha[37 * 100 + 50] > 0.9);
  assert.ok(alpha[3 * 100 + 3] < 0.05);
  assert.ok(alpha[37 * 100 + 90] < 0.05);
});

test('soft cells inside the box (no fine detail) are tapered, sharp cells are kept', () => {
  const w = 80, h = 60, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = x < 40 ? (x >> 1) % 2 ? 230 : 20 : 128; // left half: fine detail; right half: flat
    data.set([v, v, v, 255], (y * w + x) * 4);
  }
  const grid = approximateSubjectGrid({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 0.75, { data, width: w, height: h });
  const mask = createSubjectMask('a', grid, 'k', 'medium');
  const alpha = maskAlpha(mask, 80, 60, fullContext(80, 60));
  const sharp = alpha[30 * 80 + 28], flat = alpha[30 * 80 + 52];
  assert.ok(sharp > flat, 'detail side is stronger');
  assert.ok(flat >= 0.4, 'but never removed: this is a box fallback, not an outline');
});
