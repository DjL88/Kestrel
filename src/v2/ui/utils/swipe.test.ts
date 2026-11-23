import assert from 'node:assert/strict';
import test from 'node:test';
import { stepFrom, swipeIntent } from './swipe.ts';

test('a clear flick on each axis is read, and the direction follows the finger', () => {
  assert.equal(swipeIntent(-120, 10, 200), 'next-photo');
  assert.equal(swipeIntent(120, -10, 200), 'previous-photo');
  assert.equal(swipeIntent(5, -120, 200), 'next-format');
  assert.equal(swipeIntent(-5, 120, 200), 'previous-format');
});

test('short, diagonal, slow or odd movements are not swipes', () => {
  assert.equal(swipeIntent(-30, 0, 100), null);
  assert.equal(swipeIntent(-100, 90, 200), null);
  assert.equal(swipeIntent(-200, 0, 1200), null);
  assert.equal(swipeIntent(Number.NaN, 0, 100), null);
  assert.equal(swipeIntent(-100, 0, -5), null);
});

test('stepping stops at either end and never wraps', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(stepFrom(list, 'b', 1)?.id, 'c');
  assert.equal(stepFrom(list, 'b', -1)?.id, 'a');
  assert.equal(stepFrom(list, 'c', 1), undefined);
  assert.equal(stepFrom(list, 'a', -1), undefined);
  assert.equal(stepFrom(list, 'missing', 1), undefined);
});
