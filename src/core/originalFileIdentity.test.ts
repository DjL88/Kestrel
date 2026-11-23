import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hashOriginalBytes, isSameOriginalBytes } from './originalFileIdentity';
import { RangeBlob } from '../providers/rangeBlob';

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


test('desktop ranged source hashes exact bytes in bounded reads without full RAW materialisation', async () => {
  const bytes = new Uint8Array(2 * 1024 * 1024 + 73);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 37 + 9) % 256;
  const requests: number[] = [];
  const source = RangeBlob.of(async (offset, length) => {
    requests.push(length);
    return bytes.slice(offset, offset + length);
  }, bytes.length);
  assert.equal(await hashOriginalBytes(source), createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(requests, [1024 * 1024, 1024 * 1024, 73]);
});

test('ranged source rejects truncated bytes rather than accepting a partial fingerprint', async () => {
  const source = RangeBlob.of(async (_offset, length) => new Uint8Array(Math.max(0, length - 1)), 1024 * 1024 + 1);
  await assert.rejects(hashOriginalBytes(source), /ended before the expected bytes/);
});

test('ranged SHA-256 refuses same-size replacement bytes even when metadata matches', async () => {
  const original = new Uint8Array([1, 2, 3, 4]);
  const changed = new Uint8Array([1, 2, 3, 5]);
  const source = (bytes: Uint8Array) => RangeBlob.of(async (offset, length) => bytes.slice(offset, offset + length), bytes.length);
  assert.equal(isSameOriginalBytes(await hashOriginalBytes(source(original)), await hashOriginalBytes(source(changed))), false);
});
