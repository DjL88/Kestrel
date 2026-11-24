import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDenoiseSource } from './denoiseSource';
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

test('connected HEIF/WebP may be decoded but offline review and late fallback never qualify', async () => {
  let offline = false, decoded = 0;
  const provider = { getFullPreviewUrl: async () => 'connected', isDeveloped: () => false, isOfflineFallback: () => offline };
  const original = async () => { throw Error('not JPEG/PNG or RAW'); };
  for (const filename of ['bird.heic', 'bird.webp']) {
    offline = false;
    const other = {...frame, filename};
    assert.equal(await loadDenoiseSource(other, provider, original, async u => { decoded++; return u; }), 'connected');
    offline = true;
    assert.equal(await loadDenoiseSource(other, provider, original, async () => { throw Error('must not decode review'); }), null);
    offline = false;
    assert.equal(await loadDenoiseSource(other, provider, original, async u => { offline = true; return u; }), null);
  }
  assert.equal(decoded, 2);
});
