import assert from 'node:assert/strict';
import test from 'node:test';
import { newId } from './ids';
import { sha256Plain, sha256Hex } from './sha256';

test('ids look like version 4 UUIDs and do not repeat, even without randomUUID', () => {
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(newId(), pattern);
  const original = globalThis.crypto.randomUUID;
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
  try {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    assert.equal(ids.size, 500);
    for (const id of ids) assert.match(id, pattern);
  } finally {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true });
  }
});

test('the plain SHA-256 matches the published test vectors', () => {
  const text = (value: string) => new TextEncoder().encode(value);
  assert.equal(sha256Plain(new Uint8Array()), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Plain(text('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Plain(text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.equal(sha256Plain(new Uint8Array(1_000_000).fill(0x61)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});

test('both paths agree on arbitrary data, including sizes around the block boundary', async () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 1000]) {
    const data = Uint8Array.from({ length: size }, (_, i) => (i * 31 + 7) & 255);
    assert.equal(await sha256Hex(data.buffer), sha256Plain(data), `size ${size}`);
  }
});
