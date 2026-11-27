import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadAhead, importLanes } from './importReadAhead';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('photos taken one at a time are read several at once, each read exactly once', async () => {
  const reads: number[] = [];
  let inFlight = 0;
  let most = 0;
  const ahead = createReadAhead(8, 4, async (index) => {
    reads.push(index);
    inFlight += 1; most = Math.max(most, inFlight);
    await wait(40);
    inFlight -= 1;
    return `photo ${index}`;
  });
  const started = Date.now();
  const got: string[] = [];
  for (let index = 0; index < 8; index += 1) got.push(await ahead.take(index)); // the scheduler's one-at-a-time turns
  const took = Date.now() - started;
  assert.deepEqual(got, [0, 1, 2, 3, 4, 5, 6, 7].map((index) => `photo ${index}`));
  assert.deepEqual([...reads].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7], 'every photo read once, none twice');
  assert.equal(most, 4, 'never more than the lanes at once');
  assert.ok(took < 8 * 40 * 0.6, `about a quarter of the one-at-a-time time (${took} ms)`);
});

test('a failed photo fails in its own turn only, and a retry reads just that photo again', async () => {
  const reads: number[] = [];
  let failOnce = true;
  const ahead = createReadAhead(4, 3, async (index) => {
    reads.push(index);
    if (index === 1 && failOnce) { failOnce = false; throw new Error('unreadable'); }
    return index;
  });
  assert.equal(await ahead.take(0), 0);
  await assert.rejects(ahead.take(1), /unreadable/);
  assert.equal(await ahead.take(2), 2);
  assert.equal(await ahead.take(3), 3);
  const before = reads.length;
  assert.equal(await ahead.take(1), 1, 'Retry failed items only');
  assert.deepEqual(reads.slice(before), [1], 'the neighbours already added are not read again');
});

test('one lane is the old one-at-a-time import', async () => {
  const reads: number[] = [];
  const ahead = createReadAhead(3, 1, async (index) => { reads.push(index); return index; });
  await ahead.take(0);
  assert.deepEqual(reads, [0]);
});

test('lanes: one fewer than the cores, within the memory tier', () => {
  assert.equal(importLanes({ tier: 'high' }, 16), 6);
  assert.equal(importLanes({ tier: 'standard' }, 16), 4);
  assert.equal(importLanes({ tier: 'low' }, 16), 2);
  assert.equal(importLanes({ tier: 'high' }, 4), 3);
  assert.equal(importLanes({ tier: 'high' }, 1), 1);
  assert.equal(importLanes({ tier: 'standard' }, undefined), 1, 'unknown cores: one at a time, as before');
});
