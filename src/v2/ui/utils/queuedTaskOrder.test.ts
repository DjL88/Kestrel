import assert from 'node:assert/strict';
import test from 'node:test';
import { moveQueuedTask, placeSubset, stableTaskOrder } from './queuedTaskOrder';

test('move up/down changes only the selected adjacent pair, not the rest of the queue', () => {
  const order = [1, 2, 3, 4, 5];
  assert.deepEqual(moveQueuedTask(order, 4, -1), [1, 2, 4, 3, 5]);
  assert.deepEqual(moveQueuedTask(order, 2, 1), [1, 3, 2, 4, 5]);
  assert.deepEqual(order, [1, 2, 3, 4, 5]);
  assert.deepEqual(moveQueuedTask(order, 1, -1), order);
  assert.deepEqual(moveQueuedTask(order, 5, 1), order);
  assert.deepEqual(moveQueuedTask(order, 99, 1), order);
});

test('a task keeps its place while it flips between running, queued, paused and done', () => {
  let order = stableTaskOrder([], [{ id: '1' }, { id: '2' }, { id: '3' }]);
  assert.deepEqual(order, ['1', '2', '3']);
  // Status, progress and update time are not inputs, so a batch handed back to the queue
  // between photographs, or finishing, cannot move.
  order = stableTaskOrder(order, [{ id: '3' }, { id: '1' }, { id: '2' }]);
  assert.deepEqual(order, ['1', '2', '3']);
  // The scheduler raises priority when the person reorders; rows already shown do not jump.
  order = stableTaskOrder(order, [{ id: '1' }, { id: '2', priority: 5 }, { id: '3', priority: 9 }]);
  assert.deepEqual(order, ['1', '2', '3']);
});

test('removed tasks drop out and new tasks join at the end, highest priority first', () => {
  const order = stableTaskOrder(['1', '2', '3'], [{ id: '1' }, { id: '3' }, { id: '7' }, { id: '5', priority: 2 }, { id: '6' }]);
  assert.deepEqual(order, ['1', '3', '5', '6', '7']);
});

test('moving a queued task refills only the queued places and leaves the running row alone', () => {
  // 1 running, 2 and 3 queued, 4 finished: moving 3 up swaps only 2 and 3.
  const order = ['1', '2', '3', '4'];
  assert.deepEqual(placeSubset(order, ['3', '2']), ['1', '3', '2', '4']);
  // Running row between queued rows stays put.
  assert.deepEqual(placeSubset(['2', '1', '3'], ['3', '2']), ['3', '1', '2']);
  // A mismatched subset never drops or duplicates a row.
  assert.deepEqual(placeSubset(order, ['3', '9']), order);
});
