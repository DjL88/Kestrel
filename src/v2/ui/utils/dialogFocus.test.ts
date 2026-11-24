import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextFocusIndex } from './dialogFocus.ts';

test('Tab wraps from the last control to the first, Shift+Tab from the first to the last', () => {
  assert.equal(nextFocusIndex(4, 3, false), 0);
  assert.equal(nextFocusIndex(4, 0, true), 3);
});

test('Tab moves one step inside the dialog', () => {
  assert.equal(nextFocusIndex(4, 1, false), 2);
  assert.equal(nextFocusIndex(4, 2, true), 1);
});

test('focus outside the controls (on the panel itself) enters at the start, or the end with Shift', () => {
  assert.equal(nextFocusIndex(4, -1, false), 0);
  assert.equal(nextFocusIndex(4, -1, true), 3);
});

test('a dialog with nothing focusable gives -1', () => {
  assert.equal(nextFocusIndex(0, -1, false), -1);
});
