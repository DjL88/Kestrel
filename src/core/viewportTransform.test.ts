import test from 'node:test';
import assert from 'node:assert/strict';
import { FIT_VIEW, transformViewport } from './viewportTransform';

const bounds = { left: 100, top: 50, width: 400, height: 300 };

test('zoom keeps the point under the moving pinch centroid', () => {
  const at = { x: 340, y: 245 };
  const next = { x: 350, y: 265 };
  const zoomed = transformViewport(FIT_VIEW, bounds, 2, at, next);
  assert.deepEqual(zoomed, { zoom: 2, pan: { x: -30, y: -25 } });
  assert.equal(300 + (at.x - 300) * zoomed.zoom + zoomed.pan.x, next.x);
  assert.equal(200 + (at.y - 200) * zoomed.zoom + zoomed.pan.y, next.y);
});

test('drag translates an already zoomed viewport and fit recenters it', () => {
  const current = { zoom: 2, pan: { x: -30, y: -25 } };
  assert.deepEqual(transformViewport(current, bounds, 2, { x: 300, y: 200 }, { x: 315, y: 205 }), {
    zoom: 2, pan: { x: -15, y: -20 },
  });
  assert.deepEqual(transformViewport(current, bounds, 0.5, { x: 315, y: 205 }), FIT_VIEW);
});
