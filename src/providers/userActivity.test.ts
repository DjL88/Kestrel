import test from 'node:test';
import assert from 'node:assert/strict';
import { quietWaitMs } from './userActivity';

test('background work waits out the rest of the quiet time after the last key or click', () => {
  assert.equal(quietWaitMs(10_000, 9_000, 1_500), 500);
  assert.equal(quietWaitMs(10_000, 8_000, 1_500), 0);
  assert.equal(quietWaitMs(10_000, 0, 1_500), 0, 'no input yet: run now');
});
