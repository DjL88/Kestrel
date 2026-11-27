import assert from 'node:assert/strict';
import test from 'node:test';
import { oneWholeFileReadAtATime } from './nativeImportIo';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('whole-file reads take turns (one reader on a spinning disk), in the order asked, and a failure does not stop the next', async () => {
  let reading = 0;
  let most = 0;
  const order: number[] = [];
  const read = (index: number, fail = false) => oneWholeFileReadAtATime(async () => {
    reading += 1; most = Math.max(most, reading);
    await wait(10);
    order.push(index);
    reading -= 1;
    if (fail) throw new Error('drive gone');
    return index;
  });
  const results = await Promise.allSettled([read(0), read(1, true), read(2), read(3)]);
  assert.equal(most, 1, 'never two whole-file reads at once');
  assert.deepEqual(order, [0, 1, 2, 3]);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
});
