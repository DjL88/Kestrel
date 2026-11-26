import assert from 'node:assert/strict';
import test from 'node:test';
import type { HotFolderFile } from '../core/hotFolder';
import { watchHotFolder, type HotFolderSource } from './hotFolderWatch';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeFolder(files: HotFolderFile[]): HotFolderSource {
  return {
    name: 'Tether',
    list: async (skip) => files.filter((file) => !skip.has(file.key)),
    open: async (file) => ({ name: file.name, size: file.size, lastModified: file.lastModified, read: async () => new File([], file.name) }),
  };
}

test('watching imports each settled frame once, and retries frames a busy import could not take', async () => {
  const files: HotFolderFile[] = [{ key: 'a.cr3', name: 'a.cr3', size: 10, lastModified: 1 }];
  const imported: string[] = [];
  let busy = true;
  const controller = new AbortController();
  const statuses: number[] = [];
  watchHotFolder(fakeFolder(files), {
    signal: controller.signal, intervalMs: 5,
    onReady: async (photos) => { if (busy) { busy = false; return false; } imported.push(...photos.map((p) => p.name)); return true; },
    onStatus: (status) => statuses.push(status.imported),
  });
  await wait(60);
  files.push({ key: 'b.cr3', name: 'b.cr3', size: 12, lastModified: 2 });
  await wait(60);
  controller.abort();
  assert.deepEqual(imported, ['a.cr3', 'b.cr3']);
  assert.equal(statuses.at(-1), 2);
});

test('an unreadable folder is reported and watching carries on', async () => {
  let fail = true;
  const controller = new AbortController();
  const problems: boolean[] = [];
  const source = fakeFolder([{ key: 'x.jpg', name: 'x.jpg', size: 3, lastModified: 1 }]);
  const list = source.list;
  source.list = async (skip) => { if (fail) { fail = false; throw new Error('unplugged'); } return list(skip); };
  const imported: string[] = [];
  watchHotFolder(source, { signal: controller.signal, intervalMs: 5, onReady: async (p) => { imported.push(...p.map((x) => x.name)); return true; }, onStatus: (s) => problems.push(s.problem) });
  await wait(60);
  controller.abort();
  assert.equal(problems[0], true);
  assert.equal(problems.at(-1), false);
  assert.deepEqual(imported, ['x.jpg']);
});
