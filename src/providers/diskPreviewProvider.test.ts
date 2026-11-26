import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserPreviewProvider, type OfflinePreviewCache } from './browserPreviewProvider';
import type { DiskBuildRequest, DiskBuildResult, DiskPreviewLevel, DiskPreviewStore } from './diskPreviewCache';
import type { PhotoFrame } from '../core/types';

const frame = (stableKey: string, filename = `${stableKey}.nef`) => ({ id: `f-${stableKey}`, stableKey, filename }) as PhotoFrame;
const noIndexedDb: OfflinePreviewCache = { savePreviewPair: async () => false, loadPreviewPair: async () => null };

/** An in-memory stand-in for the desktop app's preview folder (src-tauri/src/preview_cache.rs). */
function fakeStore(fail = new Set<string>()) {
  const stored = new Map<string, Record<DiskPreviewLevel, Blob>>();
  const calls: DiskBuildRequest[][] = [];
  const store: DiskPreviewStore = {
    async build(requests) {
      calls.push(requests);
      return requests.map((request): DiskBuildResult => {
        if (fail.has(request.path)) return { key: request.key, status: 'failed', error: 'This RAW file could not be read.' };
        stored.set(request.key, {
          thumb: new Blob([`thumb ${request.path}`], { type: 'image/jpeg' }),
          review: new Blob([`review ${request.path}`], { type: 'image/jpeg' }),
          smart: new Blob([`smart ${request.path}`], { type: 'image/jpeg' }),
        });
        return { key: request.key, status: 'built', madeFrom: 'raw', codec: 'nikon-he' };
      });
    },
    async read(key, level) { return stored.get(key)?.[level] ?? null; },
    async rotate() {},
    async usage() { return { bytes: 0, entries: stored.size }; },
    async clear() { stored.clear(); return { bytes: 0, entries: 0 }; },
  };
  return { store, calls };
}

const link = (provider: BrowserPreviewProvider, key: string, extra: { path?: string; sha256?: string } = { path: `/photos/${key}.nef`, sha256: 'ab'.repeat(32) }) =>
  provider.registerLinked(key, { size: 10, lastModified: 1, read: async () => { throw new Error('the page must not read the RAW'); }, ...extra });

test('disk previews are made from the path only when the app has the folder, a path and the bytes’ hash', () => {
  const { store } = fakeStore();
  const desktop = new BrowserPreviewProvider(noIndexedDb, store);
  link(desktop, 'a');
  link(desktop, 'b', { path: '/photos/b.nef' });
  assert.equal(desktop.canBuildDiskPreviews(frame('a')), true);
  assert.equal(desktop.canBuildDiskPreviews(frame('b')), false, 'no hash: equal name and size are not identity');
  assert.equal(desktop.canBuildDiskPreviews(frame('a', 'a.jpg')), false, 'RAW files only');
  const web = new BrowserPreviewProvider(noIndexedDb, null);
  link(web, 'a');
  assert.equal(web.canBuildDiskPreviews(frame('a')), false, 'the web keeps IndexedDB');
});

test('one call develops a photo and its neighbours, and the neighbours’ own turns reuse it', async () => {
  const { store, calls } = fakeStore();
  const provider = new BrowserPreviewProvider(noIndexedDb, store);
  for (const key of ['a', 'b', 'c', 'd']) link(provider, key);
  const developed: string[] = [];
  provider.events.addEventListener('developed', (event) => developed.push((event as CustomEvent<string>).detail));
  const first = await provider.buildDiskPreviews(frame('a'), [frame('b'), frame('c')]);
  assert.equal(first.codec, 'nikon-he');
  await provider.buildDiskPreviews(frame('b'), [frame('c'), frame('d')]);
  await provider.buildDiskPreviews(frame('c'), [frame('d')]);
  assert.equal(calls.length, 1, 'b and c were developed with a; their own turns ask for nothing');
  assert.deepEqual(calls[0].map((request) => request.path), ['/photos/a.nef', '/photos/b.nef', '/photos/c.nef']);
  assert.ok(calls.flat().every((request) => request.sha256 === 'ab'.repeat(32) && request.size === 10));
  assert.deepEqual(developed, ['a', 'b', 'c']);
  await provider.buildDiskPreviews(frame('d'), []);
  assert.deepEqual(calls[1].map((request) => request.path), ['/photos/d.nef'], 'd starts the next group');
  provider.clear();
});

test('the stored thumbnail, review copy and smart preview replace the camera’s preview, with the drive unplugged', async () => {
  const { store } = fakeStore();
  const provider = new BrowserPreviewProvider(noIndexedDb, store);
  link(provider, 'a');
  await provider.buildDiskPreviews(frame('a'));
  const pair = await provider.developedReview(frame('a'));
  assert.equal(await pair?.thumbnail.text(), 'thumb /photos/a.nef');
  assert.equal(await pair?.review.text(), 'review /photos/a.nef');
  // The original's reader throws, as an unplugged drive would: the editor still gets the 2,560 px smart preview.
  const full = await provider.getFullPreviewUrl(frame('a'));
  assert.equal(await (await fetch(full)).text(), 'smart /photos/a.nef');
  assert.equal(provider.pictureSourceOf(full), 'raw-review');
  assert.equal(provider.isOfflineFallback('a'), true, 'export still needs the original');
  const thumb = await provider.getThumbnailUrl(frame('a'));
  assert.equal(await (await fetch(thumb)).text(), 'thumb /photos/a.nef');
  provider.clear();
});

test('a photo that could not be developed says so and stores nothing', async () => {
  const { store } = fakeStore(new Set(['/photos/bad.nef']));
  const provider = new BrowserPreviewProvider(noIndexedDb, store);
  link(provider, 'bad');
  await assert.rejects(provider.buildDiskPreviews(frame('bad')), /could not be read/);
  assert.equal(await provider.developedReview(frame('bad')), null);
  provider.clear();
});
