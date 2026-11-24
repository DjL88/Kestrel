import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryConnector, type StorageConnector } from '../core/storageConnectors';
import { backupFolder, backupName } from '../core/autoBackup';
import { backUpNow, writeSnapshot, type BackupAdmission } from './autoBackup';
import { LOCAL_RECOVERY_TARGET, type RecoveryLocation } from './automaticRecovery';
import { createDemoShootState } from '../core/cullingEngine';

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

test('async connector cannot change the expected bytes by mutating its put buffer', async () => {
  const backing = memoryConnector();
  let retentionCalls = 0;
  const connector: StorageConnector = {
    ...backing,
    put: async (path, bytes, etag) => {
      bytes[0] ^= 1;
      await backing.put(path, bytes, etag);
    },
    list: async (prefix) => { retentionCalls++; return backing.list(prefix); },
  };
  const original = payload.slice();
  const name = backupName(projectId, new Date('2026-11-23T21:31:00Z'));
  await assert.rejects(writeSnapshot(connector, projectId, name, original), /Backup verification failed/);
  assert.deepEqual(original, payload, 'the caller-owned payload must remain unchanged');
  assert.equal(retentionCalls, 0, 'a corrupted snapshot cannot trigger retention');
});

test('caller buffer mutation during an awaited write cannot redefine a verified backup', async () => {
  const backing = memoryConnector();
  let startWrite!: () => void;
  let finishWrite!: () => void;
  const started = new Promise<void>((resolve) => { startWrite = resolve; });
  const proceed = new Promise<void>((resolve) => { finishWrite = resolve; });
  const connector: StorageConnector = {
    ...backing,
    put: async (path, bytes, etag) => {
      startWrite();
      await proceed;
      await backing.put(path, bytes, etag);
    },
  };
  const mutable = payload.slice();
  const name = backupName(projectId, new Date('2026-11-23T21:32:00Z'));
  const pending = writeSnapshot(connector, projectId, name, mutable);
  await started;
  mutable.fill(0);
  finishWrite();
  await pending;
  assert.deepEqual(await backing.get(name), payload, 'snapshot must reflect bytes at invocation');
});

test('configured source disconnect preserves device snapshot and reports retryable partial success', async () => {
  const project = createDemoShootState(1);
  const local = memoryConnector();
  const source = memoryConnector();
  const now = new Date('2026-11-24T06:15:00Z');
  let available = false;
  const recovery = {
    openDeviceRecovery: async (): Promise<RecoveryLocation> => ({ connector: local, to: 'On this device' }),
    openSourceRecovery: async (): Promise<RecoveryLocation> => available
      ? { connector: source, to: 'Photo folder' }
      : { problem: 'missing', message: 'Disconnected' },
  };
  const partial = await backUpNow(project, LOCAL_RECOVERY_TARGET, now, recovery);
  assert.equal(partial.state, 'partial');
  assert.match(partial.message ?? '', /retry/);
  const name = backupName(project.shoot.id, now);
  assert.ok(await local.get(name));
  available = true;
  const retried = await backUpNow(project, LOCAL_RECOVERY_TARGET, now, recovery);
  assert.equal(retried.state, 'ok');
  assert.deepEqual(await source.get(name), await local.get(name));
});

test('no eligible source is a successful device-only backup, but a thrown source opener is partial', async () => {
  const project = createDemoShootState(1);
  const local = memoryConnector();
  const openDeviceRecovery = async (): Promise<RecoveryLocation> => ({ connector: local, to: 'On this device' });
  const now = new Date('2026-11-24T06:16:00Z');
  assert.equal((await backUpNow(project, LOCAL_RECOVERY_TARGET, now, {
    openDeviceRecovery, openSourceRecovery: async () => null,
  })).state, 'ok');
  assert.equal((await backUpNow(project, LOCAL_RECOVERY_TARGET, now, {
    openDeviceRecovery, openSourceRecovery: async () => { throw new Error('offline'); },
  })).state, 'partial');
});

test('recovery destinations release scheduler admission between verified writes', async () => {
  const project = createDemoShootState(1);
  const events: string[] = [];
  let active = false;
  const admit: BackupAdmission = async work => {
    assert.equal(active, false, 'must not hold nested reservations');
    active = true; events.push('enter');
    try { return await work(); }
    finally { active = false; events.push('exit'); }
  };
  const target = (label: string): StorageConnector => {
    const backing = memoryConnector();
    return {
      ...backing,
      put: async (...args) => { assert.equal(active, true); events.push(label + ':put'); return backing.put(...args); },
      get: async (...args) => { assert.equal(active, true); events.push(label + ':verify'); return backing.get(...args); },
      list: async (...args) => { assert.equal(active, true); events.push(label + ':retention'); return backing.list(...args); },
    };
  };
  const local = target('local'), source = target('source');
  const result = await backUpNow(project, LOCAL_RECOVERY_TARGET, new Date('2026-11-24T07:00:00Z'), {
    openDeviceRecovery: async () => { assert.equal(active, true); return { connector: local, to: 'On this device' }; },
    openSourceRecovery: async () => { assert.equal(active, true); return { connector: source, to: 'Photo folder' }; },
  }, admit);
  assert.equal(result.state, 'ok');
  assert.deepEqual(events, ['enter','exit','enter','local:put','local:verify','local:retention','exit',
    'enter','exit','enter','source:put','source:verify','source:retention','exit']);
  assert.equal(active, false);
});
