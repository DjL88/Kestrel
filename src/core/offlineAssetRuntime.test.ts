import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOfflineAssetRuntime } from './offlineAssetRuntime';
import type { ActiveAsset, ApprovedAsset } from './verifiedAssetActivation';

const bytes = new TextEncoder().encode('approved local colour notes');
const digest = async (data: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
    b => b.toString(16).padStart(2, '0')).join('');
async function fixture() {
  const hash = await digest(bytes);
  const asset: ApprovedAsset = { id: 'colour-notes', version: '1.0.0', kind: 'knowledge',
    sha256: hash, bytes: bytes.length, licence: 'CC0-1.0', provenance: 'owner-authored', approved: true };
  const files = new Map<string, Uint8Array>(), pointers = new Map<string, ActiveAsset>();
  const previous = new Map<string, ActiveAsset>();
  let verification = 0;
  const slots = {
    async writeImmutable(slot: string, data: Uint8Array) { files.set(slot, data.slice()); },
    async read(slot: string) { return files.get(slot)?.slice(); },
    async active(id: string) { return pointers.get(id); },
    async previous(id: string) { return previous.get(id); },
    async compareAndSwapActive(id: string, expected: ActiveAsset | undefined, next: ActiveAsset) {
      if (pointers.get(id) !== expected) return false;
      const old = pointers.get(id);
      if (old) previous.set(id, old);
      pointers.set(id, next); return true;
    },
  };
  const authority = { async verify(_envelope: string) { verification++; return [asset]; } };
  const runtime = createOfflineAssetRuntime(authority, slots);
  const options = { currentAppVersion: '1.0.0', maxDeviceRamBytes: 1024 * 1024,
    budgetBytes: 4096, smokeTest: async () => {} };
  return { runtime, slots, files, pointers, previous, asset, options, get verification() { return verification; } };
}
test('signature authority is called before any persistent writes', async () => {
  const f = await fixture();
  const result = await f.runtime.install('signed', f.asset.id, bytes, f.options);
  assert.equal(result.sha256, f.asset.sha256);
  assert.equal(f.verification, 1);
  assert.deepEqual((await f.runtime.open(f.asset.id, async () => undefined)).bytes, bytes);
});
test('rejected signed envelope never stages bytes', async () => {
  const f = await fixture();
  const runtime = createOfflineAssetRuntime({ verify: async () => { throw Error('signature'); } }, f.slots);
  await assert.rejects(runtime.install('tampered', f.asset.id, bytes, f.options), /signature/);
  assert.equal(f.files.size, 0);
});
test('corrupt active content falls back to verified previous, not network', async () => {
  const f = await fixture();
  const old = { id: f.asset.id, version: '0.9.0', sha256: await digest(new Uint8Array([4])),
    slot: 'sha256-' + await digest(new Uint8Array([4])) };
  f.previous.set(f.asset.id, old);
  f.files.set(old.slot, new Uint8Array([4]));
  await f.runtime.install('signed', f.asset.id, bytes, f.options);
  f.files.set('sha256-' + f.asset.sha256, new Uint8Array(bytes.length));
  const result = await f.runtime.open(f.asset.id, async () => { throw Error('should not load bundle'); });
  assert.equal(result.source, 'previous');
  assert.deepEqual(result.bytes, new Uint8Array([4]));
});
test('corrupt active and previous use app-bundled offline fallback', async () => {
  const f = await fixture();
  const result = await f.runtime.open(f.asset.id, async () => new Uint8Array([9]));
  assert.equal(result.source, 'bundled');
  assert.deepEqual(result.bytes, new Uint8Array([9]));
});
test('duplicate manifest asset IDs are rejected', async () => {
  const f = await fixture();
  const runtime = createOfflineAssetRuntime({ verify: async () => [f.asset, f.asset] }, f.slots);
  await assert.rejects(runtime.install('signed', f.asset.id, bytes, f.options), /uniquely/);
  assert.equal(f.files.size, 0);
});
