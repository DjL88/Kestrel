import { describe, expect, it } from 'vitest';
import { digest, publishBackup, readVerifiedBackup, type BackupRemote } from './optionalBackupSync';
const enc = new TextEncoder();
function fixture() {
  const files = new Map<string, { bytes: Uint8Array; etag: string }>();
  let version = 0;
  const remote: BackupRemote = {
    async read(key) { const x = files.get(key); return x ? { key, bytes: Uint8Array.from(x.bytes), etag: x.etag } : null; },
    async create(key, bytes) { if (files.has(key)) return false; files.set(key, { bytes: Uint8Array.from(bytes), etag: String(++version) }); return true; },
    async compareAndSwap(key, etag, bytes) { if ((files.get(key)?.etag ?? null) !== etag) return false;
      files.set(key, { bytes: Uint8Array.from(bytes), etag: String(++version) }); return true; },
  };
  return { remote, files };
}
describe('optional backup CAS and content verification', () => {
  it('round trips verified bytes and revision', async () => {
    const { remote } = fixture(), bytes = enc.encode('{"project":"demo"}');
    const anchor = await publishBackup(remote, 'birds', bytes, null);
    expect(anchor).toEqual({ revision: 1, sha256: await digest(bytes) });
    expect((await readVerifiedBackup(remote, 'birds', anchor))?.bytes).toEqual(bytes);
    expect((await publishBackup(remote, 'birds', enc.encode('next'), anchor)).revision).toBe(2);
  });
  it('refuses blind overwrite and stale anchor', async () => {
    const { remote } = fixture();
    const first = await publishBackup(remote, 'birds', enc.encode('one'), null);
    await expect(publishBackup(remote, 'birds', enc.encode('two'), null)).rejects.toThrow('anchor');
    await publishBackup(remote, 'birds', enc.encode('two'), first);
    await expect(publishBackup(remote, 'birds', enc.encode('three'), first)).rejects.toThrow('changed');
  });
  it('rejects corrupted content and rollback', async () => {
    const { remote, files } = fixture();
    const first = await publishBackup(remote, 'birds', enc.encode('one'), null);
    const key = 'kestrel/backups/birds/objects/' + first.sha256 + '.json';
    files.get(key)!.bytes = enc.encode('tampered');
    await expect(readVerifiedBackup(remote, 'birds', first)).rejects.toThrow('verification');
    files.delete('kestrel/backups/birds/head.json');
    await expect(readVerifiedBackup(remote, 'birds', first)).rejects.toThrow('rollback');
  });
  it('refuses invalid IDs and empty payloads', async () => {
    const { remote } = fixture();
    await expect(publishBackup(remote, '../bad', enc.encode('x'), null)).rejects.toThrow('project ID');
    await expect(publishBackup(remote, 'birds', new Uint8Array(), null)).rejects.toThrow('size');
  });
  it('cancellation cannot publish pointer', async () => {
    const { remote, files } = fixture(), abort = new AbortController();
    abort.abort();
    await expect(publishBackup(remote, 'birds', enc.encode('x'), null, abort.signal)).rejects.toThrow('cancelled');
    expect(files.size).toBe(0);
  });
  it('CAS collision leaves the earlier remote pointer untouched', async () => {
    const { remote, files } = fixture();
    const first = await publishBackup(remote, 'birds', enc.encode('one'), null);
    const collision: BackupRemote = { ...remote, compareAndSwap: async () => false };
    await expect(publishBackup(collision, 'birds', enc.encode('two'), first)).rejects.toThrow('Concurrent');
    expect((await readVerifiedBackup(remote, 'birds', first))?.anchor).toEqual(first);
    expect(files.size).toBe(3);
  });
});
