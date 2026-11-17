import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadLocalFileListShoot } from './localShootLoader';
import type { PickedPhoto } from './linkedOriginals';
import type { BrowserCatalogueStore } from './browserCatalogueStore';
import type { BrowserPreviewProvider } from './browserPreviewProvider';

function fakePhoto(index: number, outcome: 'good' | 'missing' | 'changed' = 'good'): PickedPhoto {
  const name = 'DSC_' + String(index).padStart(4, '0') + '.NEF';
  const lastModified = 1_700_000_000_000 + index;
  const size = 64;
  return {
    name, size, lastModified, path: '/synthetic-shoot/' + name,
    async read() {
      if (outcome === 'missing') throw new Error('A simulated camera card was disconnected');
      return new File([new Uint8Array(outcome === 'changed' ? size + 1 : size)], name, { lastModified });
    },
  };
}

function dependencies() {
  const linked: string[] = [];
  let persisted = 0;
  const preview = {
    registerLinked(key: string) { linked.push(key); },
    async cacheOfflinePreviews() { return true; },
  } as unknown as BrowserPreviewProvider;
  const store = {
    async saveLocalFileBlob() { persisted++; throw new Error('Linked originals must not be copied to the catalogue'); },
  } as unknown as BrowserCatalogueStore;
  return { preview, store, linked, copied: () => persisted };
}

test('500-photo manual import keeps 499 readable originals and identifies the missing file', async () => {
  const deps = dependencies();
  const photos = Array.from({ length: 500 }, (_, i) => fakePhoto(i + 1, i === 242 ? 'missing' : 'good'));
  const originalNames = photos.map((p) => p.name);
  const progress: Array<{ loaded: number; total: number }> = [];
  const result = await loadLocalFileListShoot(photos, deps.preview, deps.store, ({ loaded, total }) => {
    progress.push({ loaded, total });
  });
  assert.equal(result.frames.length, 499);
  assert.deepEqual(result.failedNames, ['DSC_0243.NEF']);
  assert.equal(result.shoot.totalFrames, 499);
  assert.equal(result.storedAllBlobs, true);
  assert.deepEqual(result.uncachedPreviewKeys, []);
  assert.equal(deps.linked.length, 499, 'only readable originals get linked');
  assert.equal(deps.copied(), 0, 'desktop originals are not copied or modified');
  assert.deepEqual(photos.map((p) => p.name), originalNames, 'selection metadata never changes');
  assert.ok(progress.length >= 30, 'large imports report progressive batches');
  assert.equal(progress.at(-1)?.loaded, 499);
  assert.ok(progress.every((p) => p.total === 500));
  assert.ok(progress.every((p, i) => i === 0 || p.loaded >= progress[i - 1].loaded), 'progress is monotonic');
});

test('a modified original is skipped rather than claiming a stale file as successfully linked', async () => {
  const deps = dependencies();
  const result = await loadLocalFileListShoot(
    [fakePhoto(1), fakePhoto(2, 'changed')],
    deps.preview, deps.store,
  );
  assert.deepEqual(result.frames.map((frame) => frame.filename), ['DSC_0001.NEF']);
  assert.deepEqual(result.failedNames, ['DSC_0002.NEF']);
  assert.equal(deps.linked.length, 1);
});

test('watched imports fail as a whole so the watcher can reoffer unstable transfers', async () => {
  const deps = dependencies();
  await assert.rejects(
    loadLocalFileListShoot([fakePhoto(1), fakePhoto(2, 'missing')], deps.preview, deps.store,
      undefined, { allowPartial: false }),
    /watcher will retry/,
  );
  assert.equal(deps.copied(), 0);
});

test('unreadable-only manual selection reports failure without manufacturing an empty photo', async () => {
  const deps = dependencies();
  const result = await loadLocalFileListShoot(
    [fakePhoto(1, 'missing'), fakePhoto(2, 'changed')], deps.preview, deps.store,
  );
  assert.deepEqual(result.frames, []);
  assert.deepEqual(result.failedNames, ['DSC_0001.NEF', 'DSC_0002.NEF']);
  assert.equal(result.shoot.totalFrames, 0);
  assert.equal(deps.linked.length, 0);
});
