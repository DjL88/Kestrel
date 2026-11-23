import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryConnector, type StorageConnector } from '../core/storageConnectors';
import { backupFolder, backupName } from '../core/autoBackup';
import { writeSnapshot } from './autoBackup';

const projectId = 'readback-recovery';
const payload = new TextEncoder().encode('{"format":"kestrel-project","version":1}');

function connectorWithReadback(readback: 'exact' | 'truncated' | 'missing' | 'corrupted') {
  const backing = memoryConnector();
  let removed = 0;
  let listed = 0;
  const connector: StorageConnector = {
    ...backing,
    get: async (path) => {
      const bytes = await backing.get(path);
      if (!bytes || readback === 'missing') return null;
      if (readback === 'truncated') return bytes.slice(0, -1);
      if (readback === 'corrupted') {
        const altered = bytes.slice(); altered[0] ^= 1; return altered;
      }
      return bytes;
    },
    list: async (prefix) => { listed++; return backing.list(prefix); },
    remove: async (path) => { removed++; return backing.remove(path); },
  };
  return { connector, backing, counts: () => ({ listed, removed }) };
}

test('verified snapshot is restorable from the connector and may run retention', async () => {
  const { connector, backing, counts } = connectorWithReadback('exact');
  const name = backupName(projectId, new Date('2026-11-23T21:20:00Z'));
  await writeSnapshot(connector, projectId, name, payload);
  assert.deepEqual(await backing.get(name), payload);
  assert.equal(counts().listed, 1);
  assert.equal(counts().removed, 0);
});

for (const failure of ['truncated', 'missing', 'corrupted'] as const) {
  test(`failed ${failure} readback never prunes older backups or reports success`, async () => {
    const { connector, backing, counts } = connectorWithReadback(failure);
    const older = `${backupFolder(projectId)}/2026-11-22T21-20-00-000Z_${'a'.repeat(32)}.kestrel.json`;
    await backing.put(older, new Uint8Array([1, 2, 3]), '');
    const name = backupName(projectId, new Date('2026-11-23T21:20:00Z'));
    await assert.rejects(writeSnapshot(connector, projectId, name, payload), /Backup verification failed/);
    assert.deepEqual(await backing.get(older), new Uint8Array([1, 2, 3]));
    assert.deepEqual(counts(), { listed: 0, removed: 0 });
  });
}
