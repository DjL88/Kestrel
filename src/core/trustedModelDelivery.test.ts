import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyModelBytes, verifySignedModelManifest } from './trustedModelDelivery';

async function fixture() {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const bytes = new TextEncoder().encode('authentic model fixture');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const manifest = { schema: 1, sequence: 7, expiresAt: '2099-01-01T00:00:00Z',
    models: [{ id: 'bird-v1', version: 1, path: 'wildlife/bird.onnx', sha256: digest, bytes: bytes.length }] };
  const sign = async (data: unknown) => {
    const payload = new TextEncoder().encode(JSON.stringify(data));
    return { keyId: 'release', payload, signature: new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, payload)) };
  };
  return { manifest, bytes, sign, policy: { keys: new Map([['release', keys.publicKey]]), minimumSequence: 7, now: new Date('2026-11-20T00:00:00Z') } };
}
describe('trusted model delivery', () => {
  it('accepts a pinned signature and matching bytes', async () => {
    const f = await fixture();
    const verified = await verifySignedModelManifest(await f.sign(f.manifest), f.policy);
    assert.equal(await verifyModelBytes(verified.models[0], f.bytes), undefined);
  });
  it('rejects altered signed content', async () => {
    const f = await fixture(); const envelope = await f.sign(f.manifest);
    envelope.payload[10] ^= 1;
    await assert.rejects(verifySignedModelManifest(envelope, f.policy));
  });
  it('rejects rollback and expired manifests', async () => {
    const f = await fixture();
    await assert.rejects(verifySignedModelManifest(await f.sign({ ...f.manifest, sequence: 6 }), f.policy));
    await assert.rejects(verifySignedModelManifest(await f.sign({ ...f.manifest, expiresAt: '2020-01-01T00:00:00Z' }), f.policy));
  });
  it('rejects unsafe paths and duplicate entries', async () => {
    const f = await fixture();
    await assert.rejects(verifySignedModelManifest(await f.sign({ ...f.manifest, models: [{ ...f.manifest.models[0], path: '../bad.onnx' }] }), f.policy));
    await assert.rejects(verifySignedModelManifest(await f.sign({ ...f.manifest, models: [f.manifest.models[0], f.manifest.models[0]] }), f.policy));
  });
  it('rejects altered model bytes', async () => {
    const f = await fixture();
    await assert.rejects(verifyModelBytes(f.manifest.models[0], new Uint8Array(f.bytes.length)));
  });
});
