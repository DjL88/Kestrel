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

test('2× Fit zoom never pans beyond the visible photo edge', () => {
  const zoomed = { zoom: 2, pan: { x: 0, y: 0 } };
  assert.deepEqual(transformViewport(zoomed, bounds, 2, { x: 300, y: 200 }, { x: 3000, y: -5000 }), {
    zoom: 2, pan: { x: 200, y: -150 },
  });
  assert.deepEqual(transformViewport(zoomed, bounds, 2, { x: 300, y: 200 }, { x: -3000, y: 5000 }), {
    zoom: 2, pan: { x: -200, y: 150 },
  });
});

test('a very high zoom allows panning but still clamps to the meaningful image area', () => {
  const current = { zoom: 20, pan: { x: 0, y: 0 } };
  const moved = transformViewport(current, bounds, 20, { x: 300, y: 200 }, { x: 100000, y: -100000 }, 40);
  assert.deepEqual(moved, { zoom: 20, pan: { x: 3800, y: -2850 } });
});

test('invalid gesture coordinates and zero-sized viewports cannot blank a valid photo', () => {
  const current = { zoom: 2, pan: { x: 25, y: -15 } };
  assert.equal(transformViewport(current, bounds, Number.NaN, { x: 300, y: 200 }), current);
  assert.equal(transformViewport(current, { ...bounds, width: 0 }, 2, { x: 300, y: 200 }), current);
  assert.equal(transformViewport(current, bounds, 2, { x: Infinity, y: 200 }), current);
  assert.deepEqual(transformViewport({ zoom: 0, pan: { x: Number.NaN, y: 2 } }, bounds, 2, { x: 300, y: 200 }), FIT_VIEW);
});

test('invalid maximum-zoom input uses a safe limit rather than NaN', () => {
  const next = transformViewport(FIT_VIEW, bounds, 50, { x: 300, y: 200 }, undefined, Number.NaN);
  assert.deepEqual(next, { zoom: 6, pan: { x: 0, y: 0 } });
});
