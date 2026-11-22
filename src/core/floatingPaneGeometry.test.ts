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
  assert.deepEqual(rect, { x: 24, y: 24, width: 216, height: 156 });
});

test('layout move preserves size and clamps only position', () => {
  const rect = clampPaneRect({ x: -100, y: 24, width: 400, height: 500 }, { width: 1440, height: 900 });
  assert.equal(rect.width, 400);
  assert.equal(rect.height, 500);
  assert.equal(rect.x, 0);
  assert.equal(rect.y, 24);
});

import { defaultPaneRect } from './floatingPaneGeometry';

test('a panel first opens beside the docked panel, not on top of it', () => {
  const viewport = { width: 1280, height: 800 };
  const right = defaultPaneRect(viewport, 'right', { avoidPx: 380 });
  assert.ok(right.x + right.width <= viewport.width - 380, 'ends before the docked panel starts');
  const left = defaultPaneRect(viewport, 'left', { avoidPx: 380 });
  assert.ok(left.x >= 380, 'starts after a docked panel on the left');
});

test('further panels are nudged apart, and a small window still keeps the panel on screen', () => {
  const viewport = { width: 1280, height: 800 };
  const a = defaultPaneRect(viewport, 'right', { avoidPx: 380, index: 0 });
  const b = defaultPaneRect(viewport, 'right', { avoidPx: 380, index: 1 });
  assert.notDeepEqual(a, b);
  const tiny = defaultPaneRect({ width: 500, height: 400 }, 'right', { avoidPx: 380, index: 3 });
  assert.ok(tiny.x >= 0 && tiny.y >= 0 && tiny.x + tiny.width <= 500 && tiny.y + tiny.height <= 400);
});

import { dockZoneAt } from './floatingPaneGeometry.ts';
test('letting go near the left or right edge docks to that edge; elsewhere it does not', () => {
  assert.equal(dockZoneAt(10, 1440), 'left');
  assert.equal(dockZoneAt(72, 1440), 'left');
  assert.equal(dockZoneAt(1430, 1440), 'right');
  assert.equal(dockZoneAt(700, 1440), null);
});
test('a tiny window or bad numbers never dock', () => {
  assert.equal(dockZoneAt(5, 200), null);
  assert.equal(dockZoneAt(Number.NaN, 1440), null);
});
