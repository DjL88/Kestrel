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
test('JPEG uses its normal source; cancelled work does not return pixels', async () => {
  const provider = { getFullPreviewUrl: async () => 'jpeg', isDeveloped: () => false, isOfflineFallback: () => false };
  const jpeg = {...frame,filename:'bird.jpg'};
  const controller = new AbortController();
  assert.equal(await loadDenoiseSource(jpeg,provider,async()=>{throw Error('not RAW')},async u=>u),'jpeg');
  assert.equal(await loadDenoiseSource(jpeg,provider,async()=>'',async u=>{controller.abort();return u},controller.signal),null);
});
