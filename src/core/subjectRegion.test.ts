import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_REGION, placeInRegion, regionFromCorners, regionPixels } from './subjectRegion';

const solid = (w: number, h: number, value: number) => ({ w, h, data: btoa(String.fromCharCode(value).repeat(w * h)) });
const cells = (grid: { w: number; h: number; data: string }) => [...atob(grid.data)].map((c) => c.charCodeAt(0));

test('a region found inside an area keeps its true size and position on the whole photo', () => {
  const region = { x: 0.25, y: 0.5, w: 0.5, h: 0.25 };
  const full = placeInRegion(solid(10, 10, 255), region, 100, 80);
  const values = cells(full);
  let minX = 100, maxX = -1, minY = 80, maxY = -1, count = 0;
  values.forEach((value, index) => {
    if (!value) return;
    const x = index % 100, y = Math.floor(index / 100);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); count += 1;
  });
  assert.deepEqual([minX, maxX, minY, maxY], [25, 74, 40, 59], 'covers exactly the dragged area');
  assert.equal(count, 50 * 20);
  assert.equal(full.w, 100);
  assert.equal(full.h, 80);
});

test('detail inside the area lands in the matching place', () => {
  const left = new Uint8Array(16).map((_, i) => (i % 4 < 2 ? 255 : 0));
  const local = { w: 4, h: 4, data: btoa(String.fromCharCode(...left)) };
  const full = cells(placeInRegion(local, { x: 0.5, y: 0, w: 0.5, h: 1 }, 8, 4));
  const row = full.slice(0, 8);
  assert.deepEqual(row, [0, 0, 0, 0, 255, 255, 0, 0], 'the lit left half of the area is in the middle of the photo');
});

test('a whole-photo region changes nothing and an area outside empties nothing it should not', () => {
  const same = placeInRegion(solid(6, 6, 200), { x: 0, y: 0, w: 1, h: 1 }, 6, 6);
  assert.ok(cells(same).every((value) => value === 200));
});

test('dragged corners become a clamped region, in any direction, and tiny drags are ignored', () => {
  assert.deepEqual(regionFromCorners({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.4 }), { x: 0.2, y: 0.4, w: 0.6000000000000001, h: 0.5 });
  const edge = regionFromCorners({ x: -0.5, y: 0.2 }, { x: 1.5, y: 0.6 })!;
  assert.deepEqual([edge.x, edge.w], [0, 1]);
  assert.equal(regionFromCorners({ x: 0.5, y: 0.5 }, { x: 0.5 + MIN_REGION / 2, y: 0.9 }), null);
});

test('region pixels stay inside the canvas', () => {
  assert.deepEqual(regionPixels({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 641, 481), { x: 321, y: 241, w: 320, h: 240 });
  const p = regionPixels({ x: 0.99, y: 0.99, w: 0.01, h: 0.01 }, 100, 100);
  assert.ok(p.x + p.w <= 100 && p.y + p.h <= 100);
});
