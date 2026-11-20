import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPaneRect } from './floatingPaneGeometry';

test('floating panels remain inside a resized desktop viewport', () => {
  assert.deepEqual(clampPaneRect({ x: 1900, y: 1100, width: 350, height: 450 }, { width: 1024, height: 768 }),
    { x: 674, y: 318, width: 350, height: 450 });
});

test('a corrupted or offscreen saved rect cannot strand the dock control', () => {
  const rect = clampPaneRect({ x: NaN, y: Infinity, width: -100, height: NaN }, { width: 1366, height: 768 });
  assert.ok(rect.width >= 280 && rect.height >= 250);
  assert.ok(rect.x >= 0 && rect.y >= 0);
  assert.ok(rect.x + rect.width <= 1366 && rect.y + rect.height <= 768);
});

test('tiny viewports cannot force a floating window wider than the screen', () => {
  const rect = clampPaneRect({ x: 400, y: 300, width: 800, height: 800 }, { width: 240, height: 180 });
  assert.deepEqual(rect, { x: 0, y: 0, width: 216, height: 156 });
});

test('layout move preserves size and clamps only position', () => {
  const rect = clampPaneRect({ x: -100, y: 24, width: 400, height: 500 }, { width: 1440, height: 900 });
  assert.equal(rect.width, 400);
  assert.equal(rect.height, 500);
  assert.equal(rect.x, 0);
  assert.equal(rect.y, 24);
});
