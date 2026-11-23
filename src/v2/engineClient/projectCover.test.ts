import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoFrame } from '../../core/types.ts';
import { previewCacheKey } from '../../providers/offlinePreviewCache.ts';
import { projectCoverBlob } from './projectCover.ts';

const frame = (id: string, decision: PhotoFrame['decision'] = 'unreviewed', patch: Partial<PhotoFrame> = {}): PhotoFrame => ({
  id, stableKey: `${id}::100::25`, filename: `${id}.NEF`, sequenceIndex: 1,
  decision, burstGroupId: null, burstIndex: 0, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file', ...patch,
});

test('keeper cached thumbnail wins, removed frames are ignored and cache key matches provider', async () => {
  const frames = [frame('first'), frame('removed', 'keep', { removedAt: 0 }), frame('best', 'keep')];
  const wanted = previewCacheKey({ stableKey: 'best::100::25', filename: 'best.NEF', fileSize: 100, lastModified: 25 });
  const calls: string[] = [];
  const photo = new Blob(['preview'], { type: 'image/jpeg' });
  const result = await projectCoverBlob(frames, async (key) => { calls.push(key); return key === wanted ? photo : null; });
  assert.equal(result, photo);
  assert.deepEqual(calls, [wanted]);
});

test('missing, empty and non-image cache values never become covers', async () => {
  const frames = [frame('a'), frame('b')];
  assert.equal(await projectCoverBlob(frames, async () => null), null);
  assert.equal(await projectCoverBlob(frames, async () => new Blob([], { type: 'image/jpeg' })), null);
  assert.equal(await projectCoverBlob(frames, async () => new Blob(['bad'], { type: 'text/plain' })), null);
});

test('a non-keeper thumbnail is used when no keeper preview is cached', async () => {
  const photo = new Blob(['photo'], { type: 'image/jpeg' });
  const frames = [frame('keeper', 'keep'), frame('other')];
  const calls: string[] = [];
  const result = await projectCoverBlob(frames, async (key) => {
    calls.push(key);
    return key.includes('other') ? photo : null;
  });
  assert.equal(result, photo);
  assert.equal(calls.length, 2);
});

test('candidate search stays bounded on large projects', async () => {
  const frames = Array.from({ length: 1000 }, (_, i) => frame(String(i)));
  let reads = 0;
  await projectCoverBlob(frames, async () => { reads++; return null; });
  assert.equal(reads, 12);
});
