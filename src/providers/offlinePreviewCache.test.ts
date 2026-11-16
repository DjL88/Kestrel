import test from 'node:test';
import assert from 'node:assert/strict';
import { previewCacheKey, loadOfflinePreview, saveOfflinePreview, previewBelongsToOriginals } from './offlinePreviewCache';

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

test('project deletion only purges previews belonging to unreferenced originals', () => {
  const orphaned = new Set(['shoot-A::Z8.NEF']);
  const oldKey = previewCacheKey({ stableKey: 'shoot-A::Z8.NEF', filename: 'Z8.NEF' });
  const sharedKey = previewCacheKey({ stableKey: 'shoot-B::R5.CR3', filename: 'R5.CR3' });
  assert.equal(previewBelongsToOriginals(oldKey, orphaned), true);
  assert.equal(previewBelongsToOriginals(sharedKey, orphaned), false);
  assert.equal(previewBelongsToOriginals('not-json', orphaned), false);
  assert.equal(previewBelongsToOriginals(JSON.stringify(['shoot-A::Z8.NEF-extra']), orphaned), false);
});
