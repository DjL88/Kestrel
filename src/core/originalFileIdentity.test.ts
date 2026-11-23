import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hashOriginalBytes, isSameOriginalBytes } from './originalFileIdentity';

test('fingerprint is exact SHA-256 of original Blob, including chunk boundaries', async () => {
  for (const length of [0, 1, 64, 1024 * 1024 - 1, 1024 * 1024, 1024 * 1024 + 19]) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) bytes[i] = (i * 17 + 31) % 256;
    const expected = createHash('sha256').update(bytes).digest('hex');
    assert.equal(await hashOriginalBytes(new Blob([bytes])), expected, `length ${length}`);
  }
});

test('same filename, size and mtime does not permit substituting different bytes', async () => {
  const a = new Blob([new Uint8Array([8, 7, 6, 5])]);
  const b = new Blob([new Uint8Array([8, 7, 6, 4])]);
  const expected = await hashOriginalBytes(a);
  assert.equal(isSameOriginalBytes(expected, await hashOriginalBytes(a)), true);
  assert.equal(isSameOriginalBytes(expected, await hashOriginalBytes(b)), false);
  assert.equal(isSameOriginalBytes(undefined, expected), false);
  assert.equal(isSameOriginalBytes('not-a-sha', expected), false);
});

test('cancelled fingerprint refuses to validate', async () => {
  const signal = new AbortController();
  signal.abort();
  await assert.rejects(hashOriginalBytes(new Blob([new Uint8Array([1])]), signal.signal), /cancelled/);
});
