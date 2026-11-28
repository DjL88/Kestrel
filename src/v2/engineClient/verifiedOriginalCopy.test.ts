import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readVerifiedExportOriginal, verifyExactOriginalCopy } from './verifiedOriginalCopy';

const file = (bytes: number[]) => new Blob([new Uint8Array(bytes)]);
const digest = (bytes: number[]) => createHash('sha256').update(new Uint8Array(bytes)).digest('hex');

test('returns the same original Blob only after a real byte-for-byte fingerprint match', async () => {
  const bytes = [1, 2, 3, 4];
  const original = file(bytes);
  assert.equal(await verifyExactOriginalCopy(original, digest(bytes)), original);
});

test('same-size changed or wrongly relinked original is never exported', async () => {
  const expected = digest([1, 2, 3, 4]);
  await assert.rejects(verifyExactOriginalCopy(file([1, 2, 3, 5]), expected), /differs/);
});

test('legacy missing or malformed fingerprints fail closed', async () => {
  for (const missing of [undefined, null, '', 'bad', 'A'.repeat(64)]) {
    await assert.rejects(verifyExactOriginalCopy(file([1]), missing), /no verified original fingerprint/);
  }
});

test('empty connected original is rejected and cancellation cannot export bytes', async () => {
  const empty = file([]);
  await assert.rejects(verifyExactOriginalCopy(empty, digest([])), /empty/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(verifyExactOriginalCopy(file([1]), digest([1]), controller.signal), /cancelled/);
});

test('fingerprinting a large original verifies the last partial chunk', async () => {
  const bytes = new Uint8Array(1024 * 1024 + 3);
  bytes[bytes.length - 1] = 8;
  const original = new Blob([bytes]);
  const expected = createHash('sha256').update(bytes).digest('hex');
  assert.equal(await verifyExactOriginalCopy(original, expected), original);
  bytes[bytes.length - 1] = 7;
  const changed = new Blob([bytes]);
  await assert.rejects(verifyExactOriginalCopy(changed, expected), /differs/);
});


test('a current export reader refuses a disconnected or changed original even when old cached bytes exist', async () => {
  const cached = file([1, 2, 3]);
  const expected = digest([1, 2, 3]);
  let live: Blob | undefined;
  const reader = { read: async () => live, isCurrent: () => true };
  await assert.rejects(readVerifiedExportOriginal(reader, expected, 'bird.NEF'), /Reconnect/);
  live = file([1, 2, 4]);
  await assert.rejects(readVerifiedExportOriginal(reader, expected, 'bird.NEF'), /differs/);
  live = cached;
  const verified = await readVerifiedExportOriginal(reader, expected, 'bird.NEF');
  assert.equal(verified.bytes, cached);
});

test('a source registration change during read or later rendering invalidates an otherwise correct fingerprint', async () => {
  const bytes = file([1, 2, 3]);
  const expected = digest([1, 2, 3]);
  let current = true;
  await assert.rejects(readVerifiedExportOriginal({
    read: async () => { current = false; return bytes; },
    isCurrent: () => current,
  }, expected, 'bird.NEF'), /changed during export/);
  current = true;
  const verified = await readVerifiedExportOriginal({ read: async () => bytes, isCurrent: () => current }, expected, 'bird.NEF');
  current = false;
  assert.throws(() => verified.assertCurrent(), /changed during export/);
});

test('unverified legacy originals and cancelled export requests never start a new read', async () => {
  let reads = 0;
  const reader = { read: async () => { reads++; return file([1]); }, isCurrent: () => true };
  await assert.rejects(readVerifiedExportOriginal(reader, undefined, 'bird.NEF'), /verify its original fingerprint/);
  await assert.rejects(readVerifiedExportOriginal(reader, digest([1]), 'bird.NEF', AbortSignal.abort()), { name: 'AbortError' });
  assert.equal(reads, 0);
});
