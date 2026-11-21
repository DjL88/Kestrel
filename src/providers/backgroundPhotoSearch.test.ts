import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PhotoFrame } from '../core/types';
import { indexPhotosQuietly } from './backgroundPhotoSearch';

function frame(id: string, done = false): PhotoFrame {
  return {
    id, stableKey: 'shoot/' + id, filename: id + '.jpg',
    sequenceIndex: 0, decision: 'unreviewed', sourceKind: 'file', isDemo: false,
    burstGroupId: null, burstCount: 1, burstIndex: 1, exif: {},
    ...(done ? { searchEvidence: {
      schema: 1 as const, sourceStableKey: 'shoot/' + id, modelRevision: 'reader-v1',
      indexedAt: 100, ocr: [], subjects: [],
    } } : {}),
  };
}

test('quiet indexing skips already-indexed photos, stops at a bounded batch and commits only matching receipts', async () => {
  const saved: string[] = [];
  const scanned: string[] = [];
  const p = await indexPhotosQuietly({
    frames: [frame('cached', true), frame('one'), frame('two'), frame('three')],
    modelRevision: 'reader-v1', maxScans: 2, yieldToUi: async () => {},
    scan: async (f) => {
      scanned.push(f.id);
      return { frameId: f.id, sourceStableKey: f.stableKey, modelRevision: 'reader-v1', indexedAt: 200, ocr: [] };
    },
    save: async (r) => { saved.push(r.frameId); },
  });
  assert.deepEqual(scanned, ['one', 'two']);
  assert.deepEqual(saved, ['one', 'two']);
  assert.deepEqual(p, { scanned: 2, saved: 2, skipped: 1, failed: 0, deferred: true });
});

test('busy editor defers all scanning and cancellation commits no results', async () => {
  let scans = 0, saves = 0;
  const busy = await indexPhotosQuietly({
    frames: [frame('one')], modelRevision: 'reader-v1', isBusy: () => true,
    scan: async () => { scans++; return null; }, save: () => { saves++; },
  });
  assert.equal(busy.deferred, true);
  assert.equal(scans, 0);
  const controller = new AbortController();
  const cancelled = await indexPhotosQuietly({
    frames: [frame('one')], modelRevision: 'reader-v1', yieldToUi: async () => {},
    signal: controller.signal,
    scan: async (f) => {
      scans++;
      controller.abort();
      return { frameId: f.id, sourceStableKey: f.stableKey, modelRevision: 'reader-v1', indexedAt: 200 };
    },
    save: () => { saves++; },
  });
  assert.equal(cancelled.saved, 0);
  assert.equal(scans, 1);
  assert.equal(saves, 0);
});

test('a wrong photo receipt is rejected and a failed frame does not stop the next', async () => {
  const saves: string[] = [];
  const p = await indexPhotosQuietly({
    frames: [frame('broken'), frame('wrong'), frame('good')], modelRevision: 'reader-v1',
    yieldToUi: async () => {},
    scan: async (f) => {
      if (f.id === 'broken') throw new Error('unreadable');
      return { frameId: f.id === 'wrong' ? 'different' : f.id, sourceStableKey: f.stableKey,
        modelRevision: 'reader-v1', indexedAt: 200 };
    },
    save: (r) => { saves.push(r.frameId); },
  });
  assert.deepEqual(saves, ['good']);
  assert.equal(p.failed, 1);
  assert.equal(p.skipped, 1);
});
