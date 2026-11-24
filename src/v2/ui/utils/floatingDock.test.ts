import assert from 'node:assert/strict';
import test from 'node:test';
import { DOCKED, clampDockOffset, isDocked, nudgeDockOffset, parseDockOffset, snapDockOffset } from './floatingDock';

const area = { width: 800, height: 500 };
const control = { width: 260, height: 40 };

test('a floating control can never leave its area', () => {
  assert.deepEqual(clampDockOffset({ right: 5000, bottom: 5000 }, area, control), { right: 800 - 260 - 24, bottom: 500 - 40 - 24 });
  assert.deepEqual(clampDockOffset({ right: -40, bottom: -1 }, area, control), DOCKED);
  assert.deepEqual(clampDockOffset({ right: Number.NaN, bottom: 30.6 }, area, control), { right: 0, bottom: 31 });
});

test('an area smaller than the control keeps it docked', () => {
  assert.deepEqual(clampDockOffset({ right: 100, bottom: 100 }, { width: 200, height: 30 }, control), DOCKED);
});

test('dropping near the corner docks it again', () => {
  assert.deepEqual(snapDockOffset({ right: 10, bottom: 12 }), DOCKED);
  assert.deepEqual(snapDockOffset({ right: 120, bottom: 0 }), { right: 120, bottom: 0 });
  assert.equal(isDocked(DOCKED), true);
  assert.equal(isDocked({ right: 1, bottom: 0 }), false);
});

test('arrow keys nudge the control and Home docks it', () => {
  assert.deepEqual(nudgeDockOffset(DOCKED, 'ArrowLeft'), { right: 16, bottom: 0 });
  assert.deepEqual(nudgeDockOffset(DOCKED, 'ArrowUp'), { right: 0, bottom: 16 });
  assert.deepEqual(nudgeDockOffset({ right: 50, bottom: 50 }, 'Home'), DOCKED);
  assert.equal(nudgeDockOffset(DOCKED, 'Enter'), null);
});

test('a damaged saved place falls back to docked', () => {
  assert.deepEqual(parseDockOffset(null), DOCKED);
  assert.deepEqual(parseDockOffset('not json'), DOCKED);
  assert.deepEqual(parseDockOffset('{"right":-3,"bottom":4}'), DOCKED);
  assert.deepEqual(parseDockOffset('{"right":30,"bottom":40}'), { right: 30, bottom: 40 });
});
