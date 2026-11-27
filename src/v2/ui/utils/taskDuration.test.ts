import assert from 'node:assert/strict';
import test from 'node:test';
import { taskDuration } from './taskDuration';

test('task times read in hours and minutes, never hundreds of minutes', () => {
  assert.equal(taskDuration(0), '0 s');
  assert.equal(taskDuration(45_400), '45 s');
  assert.equal(taskDuration((27 * 60 + 5) * 1000), '27 min 5 s');
  assert.equal(taskDuration(627 * 60 * 1000), '10 h 27 min');
  assert.equal(taskDuration(60 * 60 * 1000), '1 h 0 min');
  assert.equal(taskDuration(-5), '0 s');
  assert.equal(taskDuration(Number.NaN), '0 s');
});
