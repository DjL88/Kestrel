import assert from 'node:assert/strict';
import test from 'node:test';
import { tooltipPlacement } from './tooltipPlacement.ts';

const viewport = { width: 1000, height: 700 };

test('a tooltip sits centred above its button when there is room', () => {
  const p = tooltipPlacement({ left: 490, right: 510, top: 400, bottom: 420 }, viewport);
  assert.deepEqual(p, { left: 380, bottom: 308, width: 240, below: false });
});

test('a button near the left edge keeps the whole tooltip in the window', () => {
  // The Formats panel's Edit Groups button: centring would put most of the tooltip off the left of the panel.
  const p = tooltipPlacement({ left: 222, right: 242, top: 430, bottom: 450 }, { width: 1000, height: 700 });
  assert.equal(p.left, 112);
  const nearEdge = tooltipPlacement({ left: 4, right: 24, top: 430, bottom: 450 }, viewport);
  assert.equal(nearEdge.left, 8);
  const rightEdge = tooltipPlacement({ left: 980, right: 996, top: 430, bottom: 450 }, viewport);
  assert.equal(rightEdge.left + rightEdge.width, 992);
});

test('a button near the top opens the tooltip below it', () => {
  const p = tooltipPlacement({ left: 490, right: 510, top: 40, bottom: 60 }, viewport);
  assert.equal(p.below, true);
  assert.equal(p.top, 68);
  assert.equal(p.bottom, undefined);
});

test('a narrow phone window narrows the tooltip instead of letting it run off', () => {
  const p = tooltipPlacement({ left: 180, right: 200, top: 400, bottom: 420 }, { width: 200, height: 700 });
  assert.equal(p.width, 184);
  assert.equal(p.left, 8);
});
