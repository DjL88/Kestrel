import assert from 'node:assert/strict';
import test from 'node:test';
import { directoryHandleConnector } from './folderConnector';

for (const failure of ['write', 'close'] as const) {
  test(`a failed folder ${failure} aborts the staged replacement and preserves the existing backup`, async () => {
    const original = new TextEncoder().encode('previous complete backup');
    let saved: Uint8Array = original;
    let staged: Uint8Array | undefined;
    let aborted = 0;
    const problem = new Error(`Synthetic ${failure} failure`);
    const folder = {
      async getDirectoryHandle() { return folder; },
      async getFileHandle() { return { async createWritable() { return {
        async write(bytes: Uint8Array) { staged = bytes; if (failure === 'write') throw problem; },
        async close() { if (failure === 'close') throw problem; saved = staged!; },
        async abort() { staged = undefined; aborted += 1; },
      }; } }; },
    } as unknown as FileSystemDirectoryHandle;
    await assert.rejects(directoryHandleConnector(folder).put('kestrel/v1/backups/project/backup.kestrel.json', new Uint8Array([1, 2, 3]), ''), (error) => error === problem);
    assert.equal(aborted, 1);
    assert.equal(staged, undefined);
    assert.equal(saved, original);
  });
}

test('abort failure does not hide the original write error', async () => {
  const problem = new Error('Not enough space');
  const folder = {
    async getDirectoryHandle() { return folder; },
    async getFileHandle() { return { async createWritable() { return {
      async write() { throw problem; },
      async close() { assert.fail('must not commit after write fails'); },
      async abort() { throw new Error('Drive disconnected'); },
    }; } }; },
  } as unknown as FileSystemDirectoryHandle;
  await assert.rejects(directoryHandleConnector(folder).put('kestrel/v1/backups/project/backup.kestrel.json', new Uint8Array([1]), ''), (error) => error === problem);
});

test('successful folder write commits once without aborting', async () => {
  const events: string[] = [];
  const bytes = new Uint8Array([1, 2, 3]);
  const folder = {
    async getDirectoryHandle() { return folder; },
    async getFileHandle() { return { async createWritable() { return {
      async write(data: Uint8Array) { assert.equal(data, bytes); events.push('write'); },
      async close() { events.push('close'); },
      async abort() { events.push('abort'); },
    }; } }; },
  } as unknown as FileSystemDirectoryHandle;
  await directoryHandleConnector(folder).put('kestrel/v1/backups/project/backup.kestrel.json', bytes, '');
  assert.deepEqual(events, ['write', 'close']);
});
