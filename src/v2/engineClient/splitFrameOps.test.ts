import assert from 'node:assert/strict';
import test from 'node:test';
import { readSplitFrames, readSplitPanOffset, setSplitPanOffset, toggleSplitFrames } from './splitFrameOps.ts';

test('a photo with nothing stored starts not split, centred', () => {
  assert.equal(readSplitFrames(undefined), false);
  assert.equal(readSplitPanOffset(undefined), 0);
});

test('toggling split is reversible', () => {
  const on = toggleSplitFrames(undefined);
  assert.equal(on, true);
  const off = toggleSplitFrames(on);
  assert.equal(off, false);
});

test('the pan offset is kept within -25 to 25', () => {
  assert.equal(setSplitPanOffset(10), 10);
  assert.equal(setSplitPanOffset(-10), -10);
  assert.equal(setSplitPanOffset(99), 25);
  assert.equal(setSplitPanOffset(-99), -25);
});

test('bad stored values are dropped, never trusted', () => {
  assert.equal(readSplitFrames('yes'), false);
  assert.equal(readSplitFrames(1), false);
  assert.equal(readSplitPanOffset('10'), 0);
  assert.equal(readSplitPanOffset(NaN), 0);
  assert.equal(readSplitPanOffset(undefined), 0);
});
