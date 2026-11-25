import assert from 'node:assert/strict';
import test from 'node:test';
import type { SamMask } from './efficientSam.ts';
import type { SubjectGrid } from './maskTypes.ts';

import { samConfidence, samMaskToGrid, tapInMask, tapSelectPrompt } from './tapSelectMask.ts';

const decodeGrid = (grid: SubjectGrid) => Uint8Array.from(atob(grid.data), c => c.charCodeAt(0));

function disc(w: number, h: number, cx: number, cy: number, r: number): SamMask {
  const data = new Uint8Array(w * h);
  let inside = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) { data[y * w + x] = 1; inside++; }
  return { w, h, data, score: 0.93, coverage: inside / (w * h) };
}

test('a selection becomes a recipe grid of the same shape, within the recipe limits, with soft edge cells', () => {
  const mask = disc(1024, 683, 512, 340, 200);
  const grid = samMaskToGrid(mask);
  assert.ok(grid.w <= 384 && grid.h <= 384 && grid.w >= 8 && grid.h >= 8);
  assert.ok(Math.abs(grid.w / grid.h - 1024 / 683) < 0.02);
  const values = decodeGrid(grid);
  const at = (fx: number, fy: number) => values[Math.floor(fy * grid.h) * grid.w + Math.floor(fx * grid.w)];
  assert.equal(at(0.5, 0.5), 255);
  assert.equal(at(0.02, 0.02), 0);
  // Cells that straddle the edge keep a share, so the outline is not stair-stepped.
  assert.ok(values.some(v => v > 0 && v < 255));
  // Coverage survives the resample.
  const share = values.reduce((sum, v) => sum + v / 255, 0) / values.length;
  assert.ok(Math.abs(share - mask.coverage) < 0.01);
});

test('small selections are never enlarged and tiny masks still meet the recipe minimum', () => {
  const grid = samMaskToGrid(disc(120, 80, 60, 40, 20));
  assert.deepEqual([grid.w, grid.h], [120, 80]);
  const tiny = samMaskToGrid({ w: 4, h: 2, data: new Uint8Array([1, 1, 0, 0, 1, 1, 0, 0]), score: 0.5, coverage: 0.5 });
  assert.deepEqual([tiny.w, tiny.h], [8, 8]);
  assert.throws(() => samMaskToGrid({ w: 2, h: 2, data: new Uint8Array(3), score: 1, coverage: 0 }), RangeError);
});

test('the model score is reported as its own estimate, never promoted: high only when it is very sure', () => {
  assert.equal(samConfidence(0.95), 'high');
  assert.equal(samConfidence(0.8), 'medium');
  assert.equal(samConfidence(0.5), 'low');
  assert.equal(samConfidence(Number.NaN), 'low');
});

test('taps are stored as shares of the framed photo and given to the model in mask pixels', () => {
  assert.deepEqual(tapInMask({ x: 0.5, y: 0.25, add: true }, { w: 1024, h: 683 }), { x: 512, y: 170.75, add: true });
  assert.deepEqual(tapInMask({ x: 1.4, y: -0.2, add: false }, { w: 100, h: 50 }), { x: 100, y: 0, add: false });
  assert.deepEqual(tapSelectPrompt([{ x: 0.1, y: 0.2, add: true }, { x: 0.3, y: 0.4, add: false }], { w: 10, h: 10 }),
    { taps: [{ x: 1, y: 2, add: true }, { x: 3, y: 4, add: false }] });
});
