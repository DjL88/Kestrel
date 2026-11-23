import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { linkedBytesMatchImportedOriginal } from './linkedOriginals';

test('linked original use-time authentication accepts only identical byte-for-byte contents', () => {
  const imported = new Uint8Array([1, 2, 3, 4, 5]);
  const swapped = new Uint8Array([1, 2, 3, 4, 6]); // same length and metadata possible
  const savedHash = createHash('sha256').update(imported).digest('hex');
  assert.equal(linkedBytesMatchImportedOriginal(imported, savedHash), true);
  assert.equal(linkedBytesMatchImportedOriginal(swapped, savedHash), false);
});

test('missing or malformed saved hash can never authenticate a linked original', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const sha = createHash('sha256').update(bytes).digest('hex');
  assert.equal(linkedBytesMatchImportedOriginal(bytes, ''), false);
  assert.equal(linkedBytesMatchImportedOriginal(bytes, '0'.repeat(64)), false);
  assert.equal(linkedBytesMatchImportedOriginal(bytes, sha.toUpperCase()), false);
});
