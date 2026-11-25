import assert from 'node:assert/strict';
import test from 'node:test';
import { moveQueuedTask } from './queuedTaskOrder';

test('move up/down changes only the selected adjacent pair, not the rest of the queue', () => {
  const order = [1, 2, 3, 4, 5];
  assert.deepEqual(moveQueuedTask(order, 4, -1), [1, 2, 4, 3, 5]);
  assert.deepEqual(moveQueuedTask(order, 2, 1), [1, 3, 2, 4, 5]);
  assert.deepEqual(order, [1, 2, 3, 4, 5]);
  assert.deepEqual(moveQueuedTask(order, 1, -1), order);
  assert.deepEqual(moveQueuedTask(order, 5, 1), order);
  assert.deepEqual(moveQueuedTask(order, 99, 1), order);
});
