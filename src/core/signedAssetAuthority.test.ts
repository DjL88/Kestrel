import { describe, it } from 'node:test';
import { expect } from './testExpect';
import { createSignedAssetAuthority, type SequenceFence, type SignedAssetEnvelope } from './signedAssetAuthority';

const enc = new TextEncoder();
async function fixture() {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  let current: { sequence: number; digest: string } | undefined;
  const fence: SequenceFence = {
    async read() { return current; },
    async compareAndSwap(expected, next) {
      if (JSON.stringify(expected) !== JSON.stringify(current)) return false;
      current = next; return true;
    },
  };
  const authority = createSignedAssetAuthority({
    keys: new Map([['publisher', keys.publicKey]]), fence, audience: 'kestrel',
    now: () => new Date('2026-11-21T00:00:00Z'),
  });
  const sign = async (sequence: number, overrides: Record<string, unknown> = {}) => {
    const payload = enc.encode(JSON.stringify({
      schema: 1, audience: 'kestrel', sequence, expiresAt: '2026-12-01T00:00:00Z',
      assets: [{ id: 'bird-model', version: '1.0.0', kind: 'model',
        sha256: 'a'.repeat(64), bytes: 16, licence: 'reviewed',
        provenance: 'owner-captured', approved: true }], ...overrides,
    }));
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, payload as BufferSource));
    return { keyId: 'publisher', payload, signature };
  };
  return { authority, sign, fence };
}
describe('signed asset catalogue authority', () => {
  it('accepts signed rights-approved data and exact retry', async () => {
    const f = await fixture(); const env = await f.sign(1);
    expect((await f.authority.verify(env))[0].id).toBe('bird-model');
    expect((await f.authority.verify(env)).length).toBe(1);
  });
  it('rejects tampered payload', async () => {
    const f = await fixture(); const env = await f.sign(1);
    env.payload = enc.encode(new TextDecoder().decode(env.payload).replace('bird-model', 'fake-model'));
    await expect(f.authority.verify(env)).rejects.toThrow('signature');
  });
  it('rejects cross-app signed catalogue replay', async () => {
    const f = await fixture();
    await expect(f.authority.verify(await f.sign(1, { audience: 'other-app' })))
      .rejects.toThrow('Expired or malformed');
  });
  it('rejects unknown publisher key', async () => {
    const f = await fixture(); const env = await f.sign(1); env.keyId = 'unknown';
    await expect(f.authority.verify(env)).rejects.toThrow('signature');
  });
  it('rejects older sequences and same-sequence equivocation', async () => {
    const f = await fixture(); await f.authority.verify(await f.sign(3));
    await expect(f.authority.verify(await f.sign(2))).rejects.toThrow('rollback');
    await expect(f.authority.verify(await f.sign(3, { extra: 'changed' }))).rejects.toThrow('equivocation');
  });
  it('rejects expired catalogues and executable assets', async () => {
    const f = await fixture();
    await expect(f.authority.verify(await f.sign(1, { expiresAt: '2026-01-01T00:00:00Z' })))
      .rejects.toThrow('Expired');
    await expect(f.authority.verify(await f.sign(1, { assets: [{
      id: 'codec', version: '1.0.0', kind: 'model', sha256: 'b'.repeat(64),
      bytes: 10, licence: 'approved', provenance: 'source', approved: true, executable: true,
    }] }))).rejects.toThrow('executable');
  });
  it('rejects duplicate asset IDs and unapproved assets', async () => {
    const f = await fixture();
    const a = { id: 'bird-model', version: '1.0.0', kind: 'model',
      sha256: 'a'.repeat(64), bytes: 16, licence: 'reviewed', provenance: 'source', approved: true };
    await expect(f.authority.verify(await f.sign(1, { assets: [a, a] })))
      .rejects.toThrow('Duplicate');
    await expect(f.authority.verify(await f.sign(1, { assets: [{ ...a, approved: false }] })))
      .rejects.toThrow('Unapproved');
  });
  it('fails closed when sequence fence cannot commit', async () => {
    const f = await fixture();
    const authority = createSignedAssetAuthority;
    // The fixture's fence is intentionally used as an untrusted persistence adapter.
    const broken: SequenceFence = { read: f.fence.read, compareAndSwap: async () => false };
    const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const a = authority({ keys: new Map([['x', keys.publicKey]]), fence: broken, audience: 'kestrel',
      now: () => new Date('2026-11-21T00:00:00Z') });
    const payload = enc.encode(JSON.stringify({ schema: 1, audience: 'kestrel', sequence: 1,
      expiresAt: '2026-12-01T00:00:00Z', assets: [] }));
    const env: SignedAssetEnvelope = { keyId: 'x', payload,
      signature: new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, payload as BufferSource)) };
    await expect(a.verify(env)).rejects.toThrow('contention');
  });
});
