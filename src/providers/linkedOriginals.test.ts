import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { linkedBytesMatchImportedOriginal } from './linkedOriginals';

test('linked original use-time authentication accepts only identical byte-for-byte contents', async () => {
  const imported = new Uint8Array([1, 2, 3, 4, 5]);
  const swapped = new Uint8Array([1, 2, 3, 4, 6]); // same length and metadata possible
  const savedHash = createHash('sha256').update(imported).digest('hex');
  assert.equal(await linkedBytesMatchImportedOriginal(imported, savedHash), true);
  assert.equal(await linkedBytesMatchImportedOriginal(swapped, savedHash), false);
});

test('missing or malformed saved hash can never authenticate a linked original', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const sha = createHash('sha256').update(bytes).digest('hex');
  assert.equal(await linkedBytesMatchImportedOriginal(bytes, ''), false);
  assert.equal(await linkedBytesMatchImportedOriginal(bytes, '0'.repeat(64)), false);
  assert.equal(await linkedBytesMatchImportedOriginal(bytes, sha.toUpperCase()), false);
});

test('a view into a larger buffer is checked by its own bytes only', async () => {
  const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
  const view = backing.subarray(2, 5);
  const sha = createHash('sha256').update(new Uint8Array([1, 2, 3])).digest('hex');
  assert.equal(await linkedBytesMatchImportedOriginal(view, sha), true);
});
