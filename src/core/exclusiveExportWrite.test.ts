import assert from 'node:assert/strict';
import test from 'node:test';
import { writeExclusiveBlob } from './exclusiveExportWrite';

test('exclusive writer streams multiple chunks and handles short writes without truncation', async () => {
  const expected = new Uint8Array(131_072);
  for (let i = 0; i < expected.length; i++) expected[i] = i % 251;
  const received: number[] = [];
  let closeCount = 0;
  let removals = 0;
  const blob = new Blob([expected]);
  await writeExclusiveBlob(blob, async () => ({
    async write(bytes) {
      const n = Math.min(277, bytes.byteLength);
      received.push(...bytes.slice(0, n));
      return n;
    },
    async close() { closeCount++; },
  }), async () => { removals++; });
  assert.deepEqual(new Uint8Array(received), expected);
  assert.equal(closeCount, 1);
  assert.equal(removals, 0);
});

test('pre-existing destination collision never deletes someone else\'s file', async () => {
  let removed = false;
  const collision = new Error('already exists');
  await assert.rejects(writeExclusiveBlob(new Blob(['new']), async () => { throw collision; }, async () => {
    removed = true;
  }), error => error === collision);
  assert.equal(removed, false);
});

test('partial failed writes close and remove only newly created incomplete output', async () => {
  let closes = 0;
  let removals = 0;
  await assert.rejects(writeExclusiveBlob(new Blob(['content']), async () => ({
    async write() { return 0; },
    async close() { closes++; },
  }), async () => { removals++; }), /did not accept/);
  assert.equal(closes, 1);
  assert.equal(removals, 1);
});

test('closing failure is treated as an incomplete export and cleaned up', async () => {
  let removed = false;
  await assert.rejects(writeExclusiveBlob(new Blob(['ok']), async () => ({
    async write(bytes) { return bytes.byteLength; },
    async close() { throw new Error('close failed'); },
  }), async () => { removed = true; }), /close failed/);
  assert.equal(removed, true);
});

test('cancelled streaming write closes and deletes its own incomplete output', async () => {
  const controller = new AbortController();
  let closed = 0;
  let removed = 0;
  await assert.rejects(writeExclusiveBlob(new Blob(['photo pixels']), async () => ({
    async write(bytes) {
      controller.abort();
      return bytes.byteLength;
    },
    async close() { closed++; },
  }), async () => { removed++; }, controller.signal), { name: 'AbortError' });
  assert.equal(closed, 1);
  assert.equal(removed, 1);
});

test('cancellation before opening never touches the destination', async () => {
  const controller = new AbortController();
  controller.abort();
  let opened = false;
  await assert.rejects(writeExclusiveBlob(new Blob(['content']), async () => {
    opened = true;
    throw new Error('unexpected open');
  }, async () => {}, controller.signal), { name: 'AbortError' });
  assert.equal(opened, false);
});
