import assert from 'node:assert/strict';
import test from 'node:test';
import { FINE_EDGE_FREE_MEMORY_BYTES, fineEdgeMayRun } from './fineEdgeMask.ts';
import { freeMemoryBytes } from './nativeResourceSample.ts';

const GiB = 1024 ** 3;

test('the fine-edge refinement starts only with room for its peak (about 5 GB) and the rest of the machine', () => {
  assert.equal(FINE_EDGE_FREE_MEMORY_BYTES, 6 * GiB);
  // The owner's laptop during the 27 Nov test: 14.8 of 16 GB in use.
  assert.equal(fineEdgeMayRun(1.2 * GiB), false);
  assert.equal(fineEdgeMayRun(5.9 * GiB), false);
  assert.equal(fineEdgeMayRun(6 * GiB), true);
  // No measurement (an older desktop build): as before.
  assert.equal(fineEdgeMayRun(null), true);
});

test('free memory is read from the desktop app once, and is unknown where there is no measurement', async () => {
  assert.equal(await freeMemoryBytes(async () => ({ availableMemoryBytes: 3 * GiB }), () => true), 3 * GiB);
  assert.equal(await freeMemoryBytes(async () => { throw new Error('older build'); }, () => true), null);
  assert.equal(await freeMemoryBytes(async () => ({ availableMemoryBytes: Number.NaN }), () => true), null);
  assert.equal(await freeMemoryBytes(async () => ({ availableMemoryBytes: 9 * GiB }), () => false), null, 'not asked in a browser');
});
