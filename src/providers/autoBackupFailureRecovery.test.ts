import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryConnector, type StorageConnector } from '../core/storageConnectors';
import { backupName } from '../core/autoBackup';
import { writeSnapshot } from './autoBackup';

const projectId = 'recovery-after-interrupted-write';
const older = backupName(projectId, new Date('2026-11-22T10:00:00Z'));
const newer = backupName(projectId, new Date('2026-11-23T10:00:00Z'));
const original = new Uint8Array([10, 20, 30, 40]);
const updated = new Uint8Array([50, 60, 70, 80]);

for (const failure of ['disk-full-put', 'nas-disconnected-readback'] as const) {
  test(`local recovery preserves the older verified copy on ${failure} and succeeds on retry`, async () => {
    const backing = memoryConnector();
    await backing.put(older, original.slice(), '');
    let unavailable = true;
    let listed = 0;
    let removed = 0;
    const connector: StorageConnector = {
      ...backing,
      put: async (path, bytes, etag) => {
        if (unavailable && failure === 'disk-full-put') {
          // A partial write may have reached disk before ENOSPC was reported.
          await backing.put(path, bytes.slice(0, 1), etag);
          throw new Error('ENOSPC: disk full');
        }
        return backing.put(path, bytes, etag);
      },
      get: async (path) => {
        if (unavailable && failure === 'nas-disconnected-readback' && path === newer)
          throw new Error('NAS disconnected');
        return backing.get(path);
      },
      list: async (prefix) => { listed++; return backing.list(prefix); },
      remove: async (path) => { removed++; return backing.remove(path); },
    };

    await assert.rejects(writeSnapshot(connector, projectId, newer, updated), /ENOSPC|NAS disconnected/);
    assert.deepEqual(await backing.get(older), original, 'last verified recovery copy must survive');
    assert.equal(listed, 0, 'failed verification must not run retention');
    assert.equal(removed, 0, 'failed verification must never prune recovery copies');

    unavailable = false;
    await writeSnapshot(connector, projectId, newer, updated);
    assert.deepEqual(await backing.get(newer), updated, 'retry must persist and verify the complete snapshot');
    assert.deepEqual(await backing.get(older), original, 'a retry must not alter the older snapshot');
    assert.equal(listed, 2, 'retention may run only after successful readback');
  });
}

test('a storage connector returning no bytes after a successful put cannot advance retention', async () => {
  const backing = memoryConnector();
  await backing.put(older, original.slice(), '');
  let removed = 0;
  let listed = 0;
  const connector: StorageConnector = {
    ...backing,
    get: async (path) => path === newer ? null : backing.get(path),
    list: async (prefix) => { listed++; return backing.list(prefix); },
    remove: async (path) => { removed++; return backing.remove(path); },
  };
  await assert.rejects(writeSnapshot(connector, projectId, newer, updated), /Backup verification failed/);
  assert.deepEqual(await backing.get(older), original);
  assert.equal(listed, 0);
  assert.equal(removed, 0);
});
