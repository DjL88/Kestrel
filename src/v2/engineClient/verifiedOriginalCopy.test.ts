import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { verifyExactOriginalCopy } from './verifiedOriginalCopy';

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
