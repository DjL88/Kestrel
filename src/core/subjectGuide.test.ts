import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUIDED_GRID_MAX, GUIDED_GRID_MIN, GUIDE_MIN_SIDE, guideRegion, guidedGridSize } from './subjectGuide';

const W = 2400, H = 1600;

test('a distant bird gets a cut-out around it with room for wings and tail', () => {
  const box = { x: 1500, y: 400, w: 120, h: 90 };
  const region = guideRegion(box, 0.8, W, H);
  assert.ok(region);
  // The box is inside the region, with margin on every side.
  assert.ok(region.x * W < box.x && (region.x + region.w) * W > box.x + box.w);
  assert.ok(region.y * H < box.y && (region.y + region.h) * H > box.y + box.h);
  // Never narrower than the minimum share, so there is background to separate.
  assert.ok(region.w >= GUIDE_MIN_SIDE - 1e-9 && region.h >= GUIDE_MIN_SIDE - 1e-9);
});

test('a subject near an edge keeps the full cut-out by sliding it inside the photo', () => {
  const region = guideRegion({ x: 0, y: H - 100, w: 100, h: 100 }, 0.9, W, H);
  assert.ok(region);
  assert.equal(region.x, 0);
  assert.ok(Math.abs(region.y + region.h - 1) < 1e-9);
  assert.ok(region.w >= GUIDE_MIN_SIDE - 1e-9 && region.h >= GUIDE_MIN_SIDE - 1e-9);
});

test('doubtful, damaged or photo-filling detections never steer the mask', () => {
  const box = { x: 100, y: 100, w: 200, h: 200 };
  assert.equal(guideRegion(null, 0.9, W, H), null);
  assert.equal(guideRegion(box, 0.2, W, H), null, 'low score');
  for (const score of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) assert.equal(guideRegion(box, score, W, H), null);
  assert.equal(guideRegion({ ...box, w: Number.NaN }, 0.9, W, H), null);
  assert.equal(guideRegion({ ...box, w: 0 }, 0.9, W, H), null);
  assert.equal(guideRegion({ x: 5000, y: 5000, w: 10, h: 10 }, 0.9, W, H), null, 'outside the photo');
  assert.equal(guideRegion({ x: 0, y: 0, w: W * 0.9, h: H * 0.9 }, 0.9, W, H), null, 'fills the photo already');
  assert.equal(guideRegion(box, 0.9, 0, H), null);
});

test('the guided grid is finer for small subjects and never beyond the cap', () => {
  const small = guidedGridSize(H / W, { x: 0.5, y: 0.2, w: 0.12, h: 0.12 });
  assert.equal(Math.max(small.w, small.h), GUIDED_GRID_MAX);
  const large = guidedGridSize(H / W, { x: 0, y: 0, w: 1, h: 1 });
  assert.equal(Math.max(large.w, large.h), GUIDED_GRID_MIN);
  const middle = guidedGridSize(H / W, { x: 0.2, y: 0.2, w: 0.75, h: 0.5 });
  assert.equal(Math.max(middle.w, middle.h), 256);
  // Shape follows the photo, within the validator's limits.
  for (const grid of [small, large, middle]) {
    assert.ok(grid.w >= 8 && grid.h >= 8 && grid.w <= 512 && grid.h <= 512);
  }
  const portrait = guidedGridSize(1.5, { x: 0, y: 0, w: 0.1, h: 0.1 });
  assert.ok(portrait.h > portrait.w, 'a portrait photo (height / width above 1) has its long side down the grid');
  assert.ok(small.w > small.h, 'a landscape photo has its long side across the grid');
});
