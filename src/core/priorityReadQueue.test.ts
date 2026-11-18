import assert from 'node:assert/strict';
import test from 'node:test';
import { PriorityReadQueue } from './priorityReadQueue';

function latch() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}

test('a new visible photo does not queue behind thumbnails from the previous viewport', async () => {
  const queue = new PriorityReadQueue(1);
  const first = latch();
  const order: string[] = [];
  const active = queue.run(async () => { order.push('active'); await first.wait; });
  const previous = queue.run(async () => { order.push('previous'); });
  const current = queue.run(async () => { order.push('current'); }, 'visible');
  first.release();
  await Promise.all([active, previous, current]);
  assert.deepEqual(order, ['active', 'current', 'previous']);
});

test('selected photo outranks ordinary and newer viewport reads', async () => {
  const queue = new PriorityReadQueue(1);
  const hold = latch();
  const order: string[] = [];
  const active = queue.run(async () => { order.push('active'); await hold.wait; });
  const old = queue.run(async () => { order.push('old'); }, 'visible');
  const selected = queue.run(async () => { order.push('selected'); }, 'selected');
  const newVisible = queue.run(async () => { order.push('visible'); }, 'visible');
  hold.release();
  await Promise.all([active, old, selected, newVisible]);
  assert.deepEqual(order, ['active', 'selected', 'visible', 'old']);
});

test('a selected file already queued for a thumbnail can be promoted', async () => {
  const queue = new PriorityReadQueue(1);
  const hold = latch();
  const order: string[] = [];
  const first = queue.run(async () => { order.push('first'); await hold.wait; });
  const earlier = queue.run(async () => { order.push('earlier'); }, 'visible');
  const promoted = queue.run(async () => { order.push('promoted'); }, 'background', 'photo-1695');
  queue.promote('photo-1695', 'selected');
  hold.release();
  await Promise.all([first, earlier, promoted]);
  assert.deepEqual(order, ['first', 'promoted', 'earlier']);
});

test('scheduler never exceeds configured linked disk read concurrency', async () => {
  const queue = new PriorityReadQueue(3);
  const hold = latch();
  let running = 0;
  let maximum = 0;
  const work = Array.from({ length: 11 }, (_, index) => queue.run(async () => {
    running += 1;
    maximum = Math.max(maximum, running);
    await hold.wait;
    running -= 1;
    return index;
  }));
  hold.release();
  assert.deepEqual((await Promise.all(work)).sort((a, b) => a - b),
    Array.from({ length: 11 }, (_, i) => i));
  assert.equal(maximum, 3);
});

test('failed read frees a slot for the next selected photo', async () => {
  const queue = new PriorityReadQueue(1);
  const first = queue.run(async () => { throw Error('disconnected'); });
  const next = queue.run(async () => 'loaded', 'selected');
  await assert.rejects(first, /disconnected/);
  assert.equal(await next, 'loaded');
});

test('invalid concurrency is rejected', () => {
  assert.throws(() => new PriorityReadQueue(0), RangeError);
  assert.throws(() => new PriorityReadQueue(17), RangeError);
});
