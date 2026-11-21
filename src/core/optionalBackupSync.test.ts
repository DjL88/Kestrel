import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
    assert.deepEqual(anchor, { revision: 1, sha256: await digest(bytes) });
    assert.deepEqual((await readVerifiedBackup(remote, 'birds', anchor))?.bytes, bytes);
    assert.equal((await publishBackup(remote, 'birds', enc.encode('next'), anchor)).revision, 2);
  });
  it('refuses blind overwrite and stale anchor', async () => {
    const { remote } = fixture();
    const first = await publishBackup(remote, 'birds', enc.encode('one'), null);
    await assert.rejects(publishBackup(remote, 'birds', enc.encode('two'), null), (e: Error) => e.message.includes('anchor'));
    await publishBackup(remote, 'birds', enc.encode('two'), first);
    await assert.rejects(publishBackup(remote, 'birds', enc.encode('three'), first), (e: Error) => e.message.includes('changed'));
  });
  it('rejects corrupted content and rollback', async () => {
    const { remote, files } = fixture();
    const first = await publishBackup(remote, 'birds', enc.encode('one'), null);
    const key = 'kestrel/backups/birds/objects/' + first.sha256 + '.json';
    files.get(key)!.bytes = enc.encode('tampered');
    await assert.rejects(readVerifiedBackup(remote, 'birds', first), (e: Error) => e.message.includes('verification'));
    files.delete('kestrel/backups/birds/head.json');
    await assert.rejects(readVerifiedBackup(remote, 'birds', first), (e: Error) => e.message.includes('rollback'));
  });
  it('refuses invalid IDs and empty payloads', async () => {
    const { remote } = fixture();
    await assert.rejects(publishBackup(remote, '../bad', enc.encode('x'), null), (e: Error) => e.message.includes('project ID'));
    await assert.rejects(publishBackup(remote, 'birds', new Uint8Array(), null), (e: Error) => e.message.includes('size'));
  });
  it('cancellation cannot publish pointer', async () => {
    const { remote, files } = fixture(), abort = new AbortController();
    abort.abort();
    await assert.rejects(publishBackup(remote, 'birds', enc.encode('x'), null, abort.signal), (e: Error) => e.message.includes('cancelled'));
    assert.equal(files.size, 0);
  });
  it('CAS collision leaves the earlier remote pointer untouched', async () => {
    const { remote, files } = fixture();
    const first = await publishBackup(remote, 'birds', enc.encode('one'), null);
    const collision: BackupRemote = { ...remote, compareAndSwap: async () => false };
    await assert.rejects(publishBackup(collision, 'birds', enc.encode('two'), first), (e: Error) => e.message.includes('Concurrent'));
    assert.deepEqual((await readVerifiedBackup(remote, 'birds', first))?.anchor, first);
    assert.equal(files.size, 3);
  });
});
