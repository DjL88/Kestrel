import test from 'node:test';
import assert from 'node:assert/strict';
import { previewCacheKey, loadOfflinePreview, saveOfflinePreview, previewBelongsToOriginals, MAX_RAW_DEVELOP_PREVIEW_BYTES, previewPairFits } from './offlinePreviewCache';

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

const jpeg = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
const MB = 1024 * 1024;

test('an embedded preview pair stays within 1 MB', () => {
  assert.equal(previewPairFits({ thumbnail: jpeg(45_000), review: jpeg(990_000) }), true);
  // A Z 8 develop at 2,200 px and quality 0.82 (about 1.05 MB with its thumbnail) is too big for that limit.
  assert.equal(previewPairFits({ thumbnail: jpeg(44_496), review: jpeg(1_007_727) }), false);
});

test('a RAW develop pair may take 1.5 MB, and never more', () => {
  assert.equal(MAX_RAW_DEVELOP_PREVIEW_BYTES, 1.5 * MB);
  assert.equal(previewPairFits({ thumbnail: jpeg(44_496), review: jpeg(1_007_727) }, MAX_RAW_DEVELOP_PREVIEW_BYTES), true);
  assert.equal(previewPairFits({ thumbnail: jpeg(50_000), review: jpeg(1.5 * MB) }, MAX_RAW_DEVELOP_PREVIEW_BYTES), false);
  assert.equal(previewPairFits({ thumbnail: jpeg(10), review: jpeg(10) }, 10 * MB), true, 'a larger request is capped, not trusted');
  assert.equal(previewPairFits({ thumbnail: jpeg(10), review: jpeg(2 * MB) }, 10 * MB), false);
  assert.equal(previewPairFits({ thumbnail: jpeg(10), review: new Blob([new Uint8Array(10)], { type: 'text/plain' }) }, MAX_RAW_DEVELOP_PREVIEW_BYTES), false);
});
