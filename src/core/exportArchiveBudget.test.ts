import test from 'node:test';
import assert from 'node:assert/strict';
import { requireZipCapacity, zipMemoryLimit } from './exportArchiveBudget.ts';

test('limited-memory devices get a smaller budget; no available-RAM claim is fabricated', () => {
  assert.equal(zipMemoryLimit({mobile:true}), 96 * 1024 * 1024);
  assert.equal(zipMemoryLimit({deviceMemoryGiB:2}), 96 * 1024 * 1024);
  assert.equal(zipMemoryLimit({deviceMemoryGiB:16}), 320 * 1024 * 1024);
  assert.equal(zipMemoryLimit({}), 320 * 1024 * 1024);
});
test('in-memory ZIP capacity accepts exact boundary and rejects an extra byte', () => {
  assert.equal(requireZipCapacity(80, 20, 100), 100);
  assert.throws(() => requireZipCapacity(80, 21, 100), /too large/);
  assert.throws(() => requireZipCapacity(0, Number.MAX_SAFE_INTEGER + 1, 100), /too large/);
});
