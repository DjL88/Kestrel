import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoFrame } from '../../core/types';
import { loadCollagePicture, type CollageSourceDeps, type CollageSourceProvider } from './collageSource';

const frame = (filename: string, extra: Partial<PhotoFrame> = {}) => ({ id: 'f', stableKey: 'k', filename, isDemo: false, originalSha256: 'a'.repeat(64), ...extra }) as PhotoFrame;
const picture = { naturalWidth: 96, naturalHeight: 64 } as HTMLImageElement;

function harness(state: { developed?: boolean; offline?: boolean; currentAfter?: boolean } = {}) {
  const calls: string[] = [];
  const provider = {
    verifiedOriginalReader: () => ({}),
    isDeveloped: () => state.developed ?? true,
    isOfflineFallback: () => state.offline ?? false,
  } as unknown as CollageSourceProvider;
  const deps: CollageSourceDeps = {
    loadVerifiedRasterOriginalForExport: (async () => { calls.push('raster'); return picture; }) as unknown as CollageSourceDeps['loadVerifiedRasterOriginalForExport'],
    loadExportSource: (async () => { calls.push('develop'); return picture; }) as unknown as CollageSourceDeps['loadExportSource'],
    readVerifiedExportOriginal: (async () => {
      calls.push('verify');
      return { bytes: new Blob(), assertCurrent: () => { calls.push('recheck'); if (state.currentAfter === false) throw new Error('changed'); } };
    }) as unknown as CollageSourceDeps['readVerifiedExportOriginal'],
  };
  return { calls, provider, deps };
}

test('a JPEG window uses the verified original, with or without the RAW preview', async () => {
  for (const allowRaw of [false, true]) {
    const { calls, provider, deps } = harness();
    assert.equal(await loadCollagePicture(frame('bird.jpg'), provider, undefined, allowRaw, deps), picture);
    assert.deepEqual(calls, ['raster']);
  }
});

test('with the preview off a RAW is refused as before (the raster loader says why)', async () => {
  const { calls, provider, deps } = harness();
  await loadCollagePicture(frame('bird.nef'), provider, undefined, false, deps);
  assert.deepEqual(calls, ['raster'], 'the raster loader is the one that refuses a RAW');
});

test('a RAW is verified, developed from its sensor data, then checked again before it is used', async () => {
  const { calls, provider, deps } = harness();
  assert.equal(await loadCollagePicture(frame('bird.NEF'), provider, undefined, true, deps), picture);
  assert.deepEqual(calls, ['verify', 'develop', 'recheck']);
});

test('an embedded camera preview is never used in place of a developed RAW', async () => {
  for (const state of [{ developed: false }, { offline: true }]) {
    const { provider, deps } = harness(state);
    await assert.rejects(loadCollagePicture(frame('bird.dng'), provider, undefined, true, deps), /embedded camera preview is never used/);
  }
});

test('an original that changed during the develop is not used', async () => {
  const { provider, deps } = harness({ currentAfter: false });
  await assert.rejects(loadCollagePicture(frame('bird.dng'), provider, undefined, true, deps), /changed/);
});

test('HEIF says it is not supported and nothing is substituted', async () => {
  const { calls, provider, deps } = harness();
  await assert.rejects(loadCollagePicture(frame('bird.heic'), provider, undefined, true, deps), /HEIF/);
  assert.deepEqual(calls, []);
});
