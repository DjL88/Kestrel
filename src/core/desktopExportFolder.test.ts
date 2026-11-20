import assert from 'node:assert/strict';
import test from 'node:test';
import { createDesktopFolderDestination, type DesktopExportIO } from './desktopExportFolder';
import type { ExclusiveWriteHandle } from './exclusiveExportWrite';

function memoryFolder() {
  const files = new Map<string, Uint8Array>();
  const dirs: string[] = [];
  const io: DesktopExportIO = {
    async join(...parts) { return parts.join('/'); },
    async mkdir(path) { dirs.push(path); },
    async openExclusive(path): Promise<ExclusiveWriteHandle> {
      if (files.has(path)) throw new Error('File already exists');
      const chunks: Uint8Array[] = [];
      return {
        async write(bytes) { chunks.push(bytes.slice()); return bytes.length; },
        async close() {
          const size = chunks.reduce((sum, part) => sum + part.length, 0);
          const buffer = new Uint8Array(size);
          let offset = 0;
          for (const part of chunks) { buffer.set(part, offset); offset += part.length; }
          files.set(path, buffer);
        },
      };
    },
    async removeIncomplete(path) { files.delete(path); },
  };
  return { files, dirs, io };
}
const file = (name: string, content: string) => new File([content], name, { type: 'image/jpeg' });

test('a desktop batch saves to its chosen run folder and format subfolders', async () => {
  const store = memoryFolder();
  const destination = createDesktopFolderDestination('/chosen/Kestrel Exports/run-123', store.io);
  const signal = new AbortController().signal;
  await destination.save(file('kingfisher.jpg', 'detail'), 'Instagram', signal);
  await destination.save(file('dunnock.jpg', 'detail 2'), 'Master', signal);
  assert.equal(new TextDecoder().decode(store.files.get('/chosen/Kestrel Exports/run-123/Instagram/kingfisher.jpg')), 'detail');
  assert.equal(store.files.size, 2);
  assert.deepEqual(store.dirs, ['/chosen/Kestrel Exports/run-123/Instagram', '/chosen/Kestrel Exports/run-123/Master']);
});

test('no-overwrite collision never alters an earlier output', async () => {
  const store = memoryFolder();
  const destination = createDesktopFolderDestination('/chosen/run', store.io);
  const signal = new AbortController().signal;
  await destination.save(file('bird.jpg', 'original output'), 'Master', signal);
  await assert.rejects(destination.save(file('bird.jpg', 'replacement'), 'Master', signal), /already exists/);
  assert.equal(new TextDecoder().decode(store.files.get('/chosen/run/Master/bird.jpg')), 'original output');
});

test('unsafe file and folder names fail closed before opening a file', async () => {
  const store = memoryFolder();
  const destination = createDesktopFolderDestination('/chosen/run', store.io);
  const signal = new AbortController().signal;
  for (const name of ['../bird.jpg', 'CON.jpg', 'LPT1.txt', '.hidden', 'trail. ', 'a/b.jpg']) {
    await assert.rejects(destination.save(file(name, 'pixels'), 'Master', signal), /unsafe filename/);
  }
  for (const folder of ['../Master', 'A/B', 'NUL', 'Master.']) {
    await assert.rejects(destination.save(file('bird.jpg', 'pixels'), folder, signal), /unsafe destination/);
  }
  assert.equal(store.files.size, 0);
});

test('a cancelled batch does not open a destination file', async () => {
  const store = memoryFolder();
  const destination = createDesktopFolderDestination('/chosen/run', store.io);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(destination.save(file('bird.jpg', 'pixels'), 'Master', controller.signal));
  assert.equal(store.files.size, 0);
});
