import assert from 'node:assert/strict';
import test from 'node:test';
import { trappedTabIndex } from './taskManagerFocus.ts';

test('Tab wraps from last to first and Shift+Tab wraps from first to last', () => {
  assert.equal(trappedTabIndex(2, 3, false), 0);
  assert.equal(trappedTabIndex(0, 3, true), 2);
});
test('interior Tab follows native browser focus order', () => {
  assert.equal(trappedTabIndex(1, 3, false), null);
  assert.equal(trappedTabIndex(1, 3, true), null);
});
test('focus outside the drawer is recovered in either direction', () => {
  assert.equal(trappedTabIndex(-1, 3, false), 0);
  assert.equal(trappedTabIndex(-1, 3, true), 2);
});
test('empty and single-control drawers are safe', () => {
  assert.equal(trappedTabIndex(-1, 0, false), null);
  assert.equal(trappedTabIndex(0, 1, false), 0);
  assert.equal(trappedTabIndex(0, 1, true), 0);
});
