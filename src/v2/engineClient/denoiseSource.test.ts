import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadDenoiseSource, loadVerifiedAdditionalDenoiseSource } from './denoiseSource';
import type { PhotoFrame } from '../../core/types';
const frame: PhotoFrame = { id:'raw', stableKey:'raw', filename:'bird.NEF', sequenceIndex:1, decision:'unreviewed',
  burstGroupId:null, burstIndex:0, burstCount:1, exif:{}, isDemo:false, sourceKind:'file' };
test('RAW denoise refuses embedded or offline reviews and accepts developed sensor pixels', async () => {
  let developed = false, offline = false, previews = 0;
  const provider = { getFullPreviewUrl: async () => { previews++; return 'embedded'; },
    isDeveloped: () => developed, isOfflineFallback: () => offline };
  const run = () => loadDenoiseSource(frame, provider, async () => 'sensor', async url => url);
  assert.equal(await run(), null);
  developed = true; offline = true;
  assert.equal(await run(), null);
  offline = false;
  assert.equal(await run(), 'sensor');
  assert.equal(previews, 0);
});
test('JPEG and PNG use their verified original loader, never the cached preview', async () => {
  let previewCalls = 0;
  const provider = { getFullPreviewUrl: async () => { previewCalls++; return 'review'; }, isDeveloped: () => false, isOfflineFallback: () => true };
  for (const filename of ['bird.jpg', 'bird.PNG']) {
    const raster = {...frame, filename};
    assert.equal(await loadDenoiseSource(raster, provider, async () => 'verified-original', async u => u), 'verified-original');
    await assert.rejects(loadDenoiseSource(raster, provider, async () => { throw Error('Original bytes differ'); }, async u => u), /Original bytes differ/);
  }
  assert.equal(previewCalls, 0);
});

test('cancelled JPEG original decode cannot return a denoise source', async () => {
  const provider = { getFullPreviewUrl: async () => 'review', isDeveloped: () => false, isOfflineFallback: () => false };
  const controller = new AbortController();
  assert.equal(await loadDenoiseSource({...frame, filename: 'bird.jpg'}, provider,
    async () => { controller.abort(); return 'original'; }, async u => u, controller.signal), null);
});

test('HEIF and WebP use only the original loader, never a connected or offline preview', async () => {
  let previewCalls = 0;
  const provider = { getFullPreviewUrl: async () => { previewCalls++; return 'review'; }, isDeveloped: () => false, isOfflineFallback: () => true };
  for (const filename of ['bird.heic', 'bird.webp']) {
    const other = {...frame, filename};
    assert.equal(await loadDenoiseSource(other, provider, async () => 'verified-original', async u => u), 'verified-original');
    await assert.rejects(loadDenoiseSource(other, provider, async () => { throw Error('Original unavailable'); }, async u => u), /Original unavailable/);
  }
  assert.equal(previewCalls, 0);
});

test('HEIF and WebP denoise decodes only the SHA-verified container and rejects substitution before decode', async () => {
  const webp = new Blob(['RIFF', new Uint8Array([4, 0, 0, 0]), 'WEBP']);
  const heif = new Blob([new Uint8Array([0, 0, 0, 16]), 'ftypheic', new Uint8Array(4)]);
  for (const [filename, bytes, kind] of [['bird.webp', webp, 'webp'], ['bird.heic', heif, 'heif']] as const) {
    const originalSha256 = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
    const photo = { ...frame, filename, originalSha256 };
    let decoded = 0;
    const reader = { isCurrent: () => true, read: async () => bytes };
    assert.equal(await loadVerifiedAdditionalDenoiseSource(photo, reader, async (original, format) => {
      decoded++; assert.equal(original, bytes); assert.equal(format, kind); return 'decoded';
    }), 'decoded');
    await assert.rejects(loadVerifiedAdditionalDenoiseSource({ ...photo, originalSha256: 'a'.repeat(64) }, reader,
      async () => { decoded++; return 'wrong'; }), /differs/);
    await assert.rejects(loadVerifiedAdditionalDenoiseSource({ ...photo, originalSha256: undefined }, reader,
      async () => { decoded++; return 'wrong'; }), /Reimport/);
    await assert.rejects(loadVerifiedAdditionalDenoiseSource(photo, { ...reader, read: async () => new Blob(['not the container']) },
      async () => { decoded++; return 'wrong'; }), /not a valid/);
    assert.equal(decoded, 1);
  }
});

test('source relink or cancellation during additional raster decode cannot publish a stale result', async () => {
  const bytes = new Blob(['RIFF', new Uint8Array([4, 0, 0, 0]), 'WEBP']);
  const originalSha256 = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
  const photo = { ...frame, filename: 'bird.webp', originalSha256 };
  let current = true;
  const reader = { isCurrent: () => current, read: async () => bytes };
  await assert.rejects(loadVerifiedAdditionalDenoiseSource(photo, reader, async () => { current = false; return 'stale'; }), /changed while/);
  current = true;
  const cancel = new AbortController();
  await assert.rejects(loadVerifiedAdditionalDenoiseSource(photo, reader, async () => { cancel.abort(); return 'stale'; }, cancel.signal), { name: 'AbortError' });
});
