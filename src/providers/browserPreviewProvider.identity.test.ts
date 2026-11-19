import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserPreviewProvider } from './browserPreviewProvider';
import type { PhotoFrame } from '../core/types';

const frame = (id: string, stableKey = 'same-original') =>
  ({ id, stableKey, filename: 'sample.jpg' }) as PhotoFrame;

test('replacing the source blob invalidates cached thumbnail URL and notifies mounted frames', async () => {
  const provider = new BrowserPreviewProvider();
  const key = 'replace-me';
  const photo = frame('frame-one', key);
  const first = new Blob(['FIRST'], { type: 'image/jpeg' });
  const second = new Blob(['SECOND'], { type: 'image/jpeg' });
  const signals: string[] = [];
  provider.events.addEventListener('preview-invalidated', (event) => signals.push((event as CustomEvent<string>).detail));
  provider.registerBlob(key, first);
  const url1 = await provider.getThumbnailUrl(photo);
  assert.ok(url1.startsWith('blob:'));
  assert.equal(await (await fetch(url1)).text(), 'FIRST');
  provider.registerBlob(key, second);
  const url2 = await provider.getThumbnailUrl(photo);
  assert.ok(url2.startsWith('blob:'));
  assert.notEqual(url2, url1, 'old thumbnail object URL must be evicted');
  assert.equal(await (await fetch(url2)).text(), 'SECOND');
  assert.equal(signals.filter((value) => value === key).length, 2, 'register and replacement notify listeners');
  provider.clear();
});

test('reconnecting a linked source invalidates both thumb and full preview caches', async () => {
  const provider = new BrowserPreviewProvider();
  const key = 'relinked-photo';
  const photo = frame('linked-1', key);
  let live = new Blob(['linked-A'], { type: 'image/jpeg' });
  provider.registerLinked(key, { size: live.size, lastModified: 1, read: async () => live });
  const firstThumb = await provider.getThumbnailUrl(photo);
  const firstFull = await provider.getFullPreviewUrl(photo);
  assert.equal(await (await fetch(firstThumb)).text(), 'linked-A');
  assert.equal(await (await fetch(firstFull)).text(), 'linked-A');
  live = new Blob(['linked-B'], { type: 'image/jpeg' });
  provider.retryLinkedOriginal(key);
  const nextThumb = await provider.getThumbnailUrl(photo);
  const nextFull = await provider.getFullPreviewUrl(photo);
  assert.notEqual(nextThumb, firstThumb);
  assert.notEqual(nextFull, firstFull);
  assert.equal(await (await fetch(nextThumb)).text(), 'linked-B');
  assert.equal(await (await fetch(nextFull)).text(), 'linked-B');
  provider.clear();
});

test('old concurrent thumbnail request never overwrites the replacement image cache', async () => {
  const provider = new BrowserPreviewProvider();
  const key = 'changing-disk';
  const photo = frame('frame-2', key);
  const deferred: { resolve?: (blob: Blob) => void } = {};
  provider.registerLinked(key, {
    size: 3, lastModified: 1,
    read: () => new Promise<Blob>((resolve) => { deferred.resolve = resolve; }),
  });
  const oldRequest = provider.getThumbnailUrl(photo);
  // A nonblocking read can start in the microtask queue after the request.
  for (let i = 0; i < 10 && !deferred.resolve; i++) await Promise.resolve();
  assert.ok(deferred.resolve, 'old linked read has begun');
  provider.registerBlob(key, new Blob(['NEW'], { type: 'image/jpeg' }));
  const newUrl = await provider.getThumbnailUrl(photo);
  deferred.resolve!(new Blob(['OLD'], { type: 'image/jpeg' }));
  const oldUrl = await oldRequest;
  assert.equal(oldUrl, '', 'superseded thumbnail result must be discarded');
  assert.equal(await (await fetch(newUrl)).text(), 'NEW');
  assert.equal(await (await fetch(await provider.getThumbnailUrl(photo))).text(), 'NEW');
  provider.clear();
});
