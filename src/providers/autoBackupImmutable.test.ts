import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryConnector, type StorageConnector } from '../core/storageConnectors';
import { backupName } from '../core/autoBackup';
import { writeSnapshot } from './autoBackup';

test('caller changes during an asynchronous put do not cause false corruption or alter the stored snapshot', async () => {
  const backing = memoryConnector();
  let entered!: () => void;
  let release!: () => void;
  const enteredPut = new Promise<void>((resolve) => { entered = resolve; });
  const releasePut = new Promise<void>((resolve) => { release = resolve; });
  let retention = 0;
  const connector: StorageConnector = {
    ...backing,
    put: async (path, bytes, etag) => {
      entered();
      await releasePut;
      await backing.put(path, bytes, etag);
    },
    list: async (prefix) => { retention++; return backing.list(prefix); },
  };
  const source = new Uint8Array([1, 2, 3, 4]);
  const name = backupName('immutable-test', new Date());
  const pending = writeSnapshot(connector, 'immutable-test', name, source);
  await enteredPut;
  source.fill(9);
  release();
  await pending;
  assert.deepEqual(await backing.get(name), new Uint8Array([1, 2, 3, 4]));
  assert.equal(retention, 1);
});

test('wrong stored bytes fail closed even if caller mutates to match them', async () => {
  const backing = memoryConnector();
  let retention = 0;
  const connector: StorageConnector = {
    ...backing,
    put: async (path, bytes, etag) => {
      const corrupted = bytes.slice();
      corrupted.fill(9);
      await backing.put(path, corrupted, etag);
    },
    list: async (prefix) => { retention++; return backing.list(prefix); },
  };
  const original = new Uint8Array([1, 2, 3, 4]);
  const name = backupName('immutable-test', new Date());
  await assert.rejects(writeSnapshot(connector, 'immutable-test', name, original), /Backup verification failed/);
  assert.equal(retention, 0);
  assert.deepEqual(original, new Uint8Array([1, 2, 3, 4]));
});
