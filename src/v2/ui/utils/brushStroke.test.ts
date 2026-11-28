import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRUSH_SIZE_MAX, BRUSH_SIZE_MIN, MAX_LIVE_VALUES, appendStrokePoints, brushRadius, isTypingTarget, nudgeBrushCursor, stepBrushSize,
} from './brushStroke.ts';

test('brush size maps to a radius in widths of the photo, from fine to broad, and stays in range', () => {
  assert.equal(brushRadius(BRUSH_SIZE_MIN), 0.004);
  assert.equal(brushRadius(BRUSH_SIZE_MAX), 0.2);
  assert.ok(brushRadius(20) > brushRadius(10));
  assert.equal(brushRadius(-50), brushRadius(BRUSH_SIZE_MIN));
  assert.equal(brushRadius(500), brushRadius(BRUSH_SIZE_MAX));
  assert.equal(brushRadius(Number.NaN), brushRadius(20));
});

test('[ and ] step the size and never leave the slider range', () => {
  assert.equal(stepBrushSize(20, 1), 25);
  assert.equal(stepBrushSize(20, -1), 15);
  assert.equal(stepBrushSize(98, 1), BRUSH_SIZE_MAX);
  assert.equal(stepBrushSize(3, -1), BRUSH_SIZE_MIN);
});

test('a live stroke keeps clamped points, skips ones too close together, and returns the same array when nothing is added', () => {
  const start = appendStrokePoints([], [{ x: -1, y: 0.5 }], 1);
  assert.deepEqual(start, [0, 0.5]);
  assert.equal(appendStrokePoints(start, [{ x: 0.001, y: 0.5 }], 1), start, 'too close to the last point');
  assert.equal(appendStrokePoints(start, [{ x: Number.NaN, y: 0.5 }], 1), start, 'not a number');
  const coalesced = appendStrokePoints(start, [{ x: 0.1, y: 0.5 }, { x: 0.1005, y: 0.5 }, { x: 0.2, y: 2 }], 1);
  assert.deepEqual(coalesced, [0, 0.5, 0.1, 0.5, 0.2, 1]);
  // On a tall photo a small step down is a longer distance in widths, so it is kept.
  assert.equal(appendStrokePoints([0.5, 0.5], [{ x: 0.5, y: 0.502 }], 2).length, 4);
  assert.equal(appendStrokePoints([0.5, 0.5], [{ x: 0.5, y: 0.502 }], 1).length, 2);
});

test('a live stroke stops growing at its cap', () => {
  let live: readonly number[] = [];
  for (let i = 0; i < MAX_LIVE_VALUES; i += 1) live = appendStrokePoints(live, [{ x: (i % 2) * 0.5, y: i / MAX_LIVE_VALUES }], 1);
  assert.ok(live.length <= MAX_LIVE_VALUES);
  assert.equal(appendStrokePoints(live, [{ x: 0.9, y: 0.9 }], 1), live);
});

test('arrow keys move the keyboard brush 1% (5% with Shift) and stay on the photo; other keys do nothing', () => {
  assert.deepEqual(nudgeBrushCursor({ x: 0.5, y: 0.5 }, 'ArrowRight', false), { x: 0.51, y: 0.5 });
  assert.deepEqual(nudgeBrushCursor({ x: 0.5, y: 0.5 }, 'ArrowUp', true), { x: 0.5, y: 0.45 });
  assert.deepEqual(nudgeBrushCursor({ x: 0, y: 1 }, 'ArrowLeft', true), { x: 0, y: 1 });
  assert.equal(nudgeBrushCursor({ x: 0.5, y: 0.5 }, 'a', false), null);
});

test('typing in a text field is left alone; sliders and buttons are not typing', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'text' } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: 'input', type: 'search' } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: 'INPUT', type: 'range' } as unknown as EventTarget), false);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' } as unknown as EventTarget), false);
  assert.equal(isTypingTarget(null), false);
});
