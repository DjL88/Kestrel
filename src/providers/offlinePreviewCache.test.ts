import test from 'node:test';
import assert from 'node:assert/strict';
import {
  previewCacheKey, loadOfflinePreview, loadOfflinePreviewPair,
  saveOfflinePreview, saveOfflinePreviewPair,
} from './offlinePreviewCache';

test('cache keys work for Nikon, Canon, Sony, Fujifilm, Panasonic and JPEG', () => {
  for (const filename of ['Z8.NEF', 'R5.CR3', 'A1.ARW', 'XH2.RAF', 'S5.RW2', 'IMG.JPG']) {
    assert.equal(previewCacheKey({ stableKey: 'photo', filename, fileSize: 42, lastModified: 100 }),
      previewCacheKey({ stableKey: 'photo', filename: filename.toLowerCase(), fileSize: 42, lastModified: 100 }));
  }
});
test('replaced originals do not reuse stale cached previews', () => {
  const base = { stableKey: 'original', filename: 'DSC0001.ARW', fileSize: 1024, lastModified: 100 };
  assert.notEqual(previewCacheKey(base), previewCacheKey({ ...base, lastModified: 200 }));
  assert.notEqual(previewCacheKey(base), previewCacheKey({ ...base, fileSize: 2048 }));
  assert.notEqual(previewCacheKey(base), previewCacheKey({ ...base, filename: 'DSC0001.NEF' }));
});
test('cache gracefully degrades without IndexedDB and never stores RAW data', async () => {
  assert.equal(await loadOfflinePreview('missing'), null);
  assert.equal(await saveOfflinePreview('raw', new Blob(['raw'], { type: 'application/octet-stream' })), false);
  assert.equal(await saveOfflinePreview('empty', new Blob([], { type: 'image/jpeg' })), false);
});

test('paired previews persist and legacy single previews remain readable', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  });
  const values = new Map<string, unknown>();
  const db = {
    transaction() {
      const tx = {
        oncomplete: () => {},
        objectStore: () => ({
          put(value: unknown, key: string) { values.set(key, value); queueMicrotask(() => tx.oncomplete()); },
          count() { return { result: values.size, onsuccess: () => {} }; },
          get(key: string) {
            const request = { result: values.get(key), onsuccess: () => {} };
            queueMicrotask(() => request.onsuccess());
            return request;
          },
        }),
      };
      return tx;
    },
    close() {},
  };
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: { open() {
      const request = { result: db, onsuccess: () => {} };
      queueMicrotask(() => request.onsuccess());
      return request;
    } },
  });
  const thumbnail = new Blob(['thumb'], { type: 'image/jpeg' });
  const review = new Blob(['review'], { type: 'image/jpeg' });
  assert.equal(await saveOfflinePreviewPair('pair', { thumbnail, review }), true);
  assert.deepEqual(await loadOfflinePreviewPair('pair'), { thumbnail, review });
  assert.equal(await loadOfflinePreview('pair'), thumbnail);
  assert.equal(await saveOfflinePreview('legacy', thumbnail), true);
  assert.deepEqual(await loadOfflinePreviewPair('legacy'), { thumbnail, review: thumbnail });
  const oversized = new Blob([new Uint8Array(1024 * 1024)], { type: 'image/jpeg' });
  assert.equal(await saveOfflinePreviewPair('too-large', { thumbnail, review: oversized }), false);
  assert.equal(await loadOfflinePreviewPair('too-large'), null);
});
