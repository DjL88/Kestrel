import assert from 'node:assert/strict';
import test from 'node:test';
import { drawerTabTarget } from './taskDrawerKeyboard';

test('Tab wraps from final action to first and Shift+Tab reverses', () => {
  assert.equal(drawerTabTarget(2, 3, false), 0);
  assert.equal(drawerTabTarget(0, 3, true), 2);
});
test('interior focus uses native keyboard order', () => {
  assert.equal(drawerTabTarget(1, 3, false), null);
  assert.equal(drawerTabTarget(1, 3, true), null);
});
test('focus escaping or being removed is recovered', () => {
  assert.equal(drawerTabTarget(-1, 3, false), 0);
  assert.equal(drawerTabTarget(-1, 3, true), 2);
  assert.equal(drawerTabTarget(9, 3, false), 0);
});
test('empty and invalid lists cannot redirect focus', () => {
  for (const count of [0, -1, Number.NaN, 1.5]) assert.equal(drawerTabTarget(0, count, false), null);
});
