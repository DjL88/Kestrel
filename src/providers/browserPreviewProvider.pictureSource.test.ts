import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserPreviewProvider } from './browserPreviewProvider';
import type { PhotoFrame } from '../core/types';

const raw = (id: string, stableKey: string) => ({ id, stableKey, filename: 'bird.nef' }) as PhotoFrame;

test('a persisted background develop is recorded as developed from RAW at screen size', async () => {
  const review = new Blob(['developed review'], { type: 'image/jpeg' });
  const provider = new BrowserPreviewProvider({
    async loadPreviewPair(key) { return key.startsWith('developed-v') ? { thumbnail: review, review } : null; },
    async savePreviewPair() { return true; },
  });
  const photo = raw('saved-develop', 'saved-original');
  try {
    const url = await provider.getFullPreviewUrl(photo);
    assert.equal(provider.pictureSourceOf(url), 'raw-review');
  } finally { provider.clear(); }
});

test('a full develop is recorded as developed from RAW at full size, a JPEG as its own pixels', async () => {
  const provider = new BrowserPreviewProvider();
  const photo = raw('full-develop', 'full-original');
  provider.registerBlob(photo.stableKey, new Blob(['NEF bytes']));
  provider.registerBlob('jpeg-original', new Blob(['JPEG'], { type: 'image/jpeg' }));
  try {
    assert.equal(await provider.developFromOriginal(photo.stableKey, async () => new Blob(['DEVELOPED'], { type: 'image/jpeg' })), 'ready');
    const url = await provider.getFullPreviewUrl(photo);
    assert.equal(provider.pictureSourceOf(url), 'raw-full');
    const jpeg = await provider.getFullPreviewUrl({ id: 'jpeg', stableKey: 'jpeg-original', filename: 'bird.jpg' } as PhotoFrame);
    assert.equal(provider.pictureSourceOf(jpeg), 'original');
  } finally { provider.clear(); }
});

test('an address the provider did not make has no recorded source, so nothing is labelled by guesswork', () => {
  const provider = new BrowserPreviewProvider();
  assert.equal(provider.pictureSourceOf('/demo/bird.jpg'), undefined);
  assert.equal(provider.pictureSourceOf(undefined), undefined);
});
