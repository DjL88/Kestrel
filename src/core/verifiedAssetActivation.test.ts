import { describe, expect, it } from 'vitest';
import { activateApprovedAsset, readVerifiedActive, type ActiveAsset, type AssetSlots, type ApprovedAsset } from './verifiedAssetActivation';
const bytes = new TextEncoder().encode('verified offline knowledge');
async function fixture() {
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const asset: ApprovedAsset = { id: 'colour-notes', kind: 'knowledge', version: '1.0.0', sha256: hash,
    bytes: bytes.length, licence: 'CC0-1.0', provenance: 'Kestrel authored and rights reviewed', approved: true };
  const files = new Map<string, Uint8Array>();
  const pointers = new Map<string, ActiveAsset>();
  const slots: AssetSlots = {
    writeImmutable: async (slot, data) => { if (files.has(slot)) throw Error('collision'); files.set(slot, data.slice()); },
    read: async slot => files.get(slot)?.slice(),
    active: async id => pointers.get(id),
    compareAndSwapActive: async (id, expected, next) => {
      if (pointers.get(id) !== expected) return false;
      pointers.set(id, next); return true;
    },
  };
  const opts = { asset, bytes, slots, smokeTest: async () => {}, budgetBytes: 4096,
    currentAppVersion: '1.0.0', maxDeviceRamBytes: 1024 * 1024 };
  return { files, pointers, asset, slots, opts };
}
describe('verified asset activation', () => {
  it('activates verified bytes and reopens offline', async () => {
    const f = await fixture();
    const active = await activateApprovedAsset(f.opts);
    expect(active.sha256).toBe(f.asset.sha256);
    expect(await readVerifiedActive(f.slots, f.asset.id)).toEqual(bytes);
  });
  it('does not promote changed content', async () => {
    const f = await fixture();
    await expect(activateApprovedAsset({ ...f.opts, bytes: new Uint8Array(bytes.length) })).rejects.toThrow('digest');
    expect(f.pointers.size).toBe(0);
  });
  it('rejects unapproved rights, runtime mismatch and insufficient two-version budget', async () => {
    const f = await fixture();
    await expect(activateApprovedAsset({ ...f.opts, asset: { ...f.asset, approved: false as true } })).rejects.toThrow();
    await expect(activateApprovedAsset({ ...f.opts, asset: { ...f.asset, minAppVersion: '2.0.0' } })).rejects.toThrow();
    await expect(activateApprovedAsset({ ...f.opts, budgetBytes: bytes.length })).rejects.toThrow();
  });
  it('preserves the old pointer when staging, smoke or cancellation fails', async () => {
    const f = await fixture();
    const old = { id: f.asset.id, version: '0.9.0', sha256: 'a'.repeat(64), slot: 'sha256-' + 'a'.repeat(64) };
    f.pointers.set(f.asset.id, old);
    await expect(activateApprovedAsset({ ...f.opts, smokeTest: async () => { throw Error('bad model'); } })).rejects.toThrow();
    expect(f.pointers.get(f.asset.id)).toBe(old);
    const controller = new AbortController(); controller.abort();
    await expect(activateApprovedAsset({ ...f.opts, signal: controller.signal })).rejects.toThrow('cancelled');
    expect(f.pointers.get(f.asset.id)).toBe(old);
  });
  it('rejects altered staged bytes before switching', async () => {
    const f = await fixture();
    f.slots.read = async () => new Uint8Array(bytes.length);
    await expect(activateApprovedAsset(f.opts)).rejects.toThrow('readback');
    expect(f.pointers.size).toBe(0);
  });
  it('refuses pointer conflicts without destroying the current revision', async () => {
    const f = await fixture();
    f.slots.compareAndSwapActive = async () => false;
    await expect(activateApprovedAsset(f.opts)).rejects.toThrow('pointer changed');
    expect(f.pointers.size).toBe(0);
  });
  it('refuses an older revision and same-version changed digest', async () => {
    const f = await fixture();
    f.pointers.set(f.asset.id, { id: f.asset.id, version: '2.0.0', sha256: 'a'.repeat(64), slot: 'sha256-' + 'a'.repeat(64) });
    await expect(activateApprovedAsset(f.opts)).rejects.toThrow('rollback');
    f.pointers.set(f.asset.id, { id: f.asset.id, version: '1.0.0', sha256: 'b'.repeat(64), slot: 'sha256-' + 'b'.repeat(64) });
    await expect(activateApprovedAsset(f.opts)).rejects.toThrow('same-version');
  });
  it('falls back when an active slot is corrupted or unavailable', async () => {
    const f = await fixture();
    await activateApprovedAsset(f.opts);
    f.files.set('sha256-' + f.asset.sha256, new Uint8Array(bytes.length));
    expect(await readVerifiedActive(f.slots, f.asset.id)).toBeUndefined();
  });
});
