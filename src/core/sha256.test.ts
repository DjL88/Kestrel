import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Sha256Stream, sha256Plain } from './sha256';

const reference = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('known answers', () => {
  assert.equal(sha256Plain(new Uint8Array()), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Plain(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Plain(new TextEncoder().encode('a'.repeat(1_000_000))), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('every length around the block edges matches the system implementation', () => {
  for (let length = 0; length <= 200; length += 1) {
    const bytes = randomBytes(length);
    assert.equal(sha256Plain(bytes), reference(bytes), `length ${length}`);
  }
});

test('the answer does not depend on how the bytes arrive in pieces', () => {
  const bytes = randomBytes(300_000);
  const whole = reference(bytes);
  for (const size of [1, 7, 63, 64, 65, 1000, 4096, 100_003]) {
    const stream = new Sha256Stream();
    for (let at = 0; at < bytes.length; at += size) stream.update(bytes.subarray(at, at + size));
    assert.equal(stream.digest(), whole, `pieces of ${size}`);
  }
});

test('a large file is hashed fast enough to check a model download on a phone', () => {
  const bytes = randomBytes(20_000_000);
  const started = Date.now();
  const stream = new Sha256Stream();
  for (let at = 0; at < bytes.length; at += 65536) stream.update(bytes.subarray(at, at + 65536));
  const hash = stream.digest();
  const seconds = (Date.now() - started) / 1000;
  assert.equal(hash, reference(bytes));
  // Roughly 4.5 times that for the 89 MB model. A phone is slower than this machine, so leave a wide margin.
  assert.ok(seconds < 5, `20 MB took ${seconds.toFixed(1)} s`);
});
