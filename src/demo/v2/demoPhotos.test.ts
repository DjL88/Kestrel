import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDemoFiles, loadDemoPhotos } from './demoPhotos.ts';

const json = (body: unknown, ok = true) => ({ ok, headers: { get: () => 'application/json' }, json: async () => body }) as unknown as Response;

test('published photos win; the bundled illustrations are the fallback and are labelled as such', async () => {
  const published = await loadDemoPhotos((async (url: string) => url === '/v1/demo/photos'
    ? json({ photos: [{ id: 'a', title: 'Owl', imageUrl: 'https://x/owl.jpg' }, { id: 'b', title: 'No image', imageUrl: null }] })
    : json({}, false)) as unknown as typeof fetch);
  assert.deepEqual(published, [{ id: 'a', title: 'Owl', url: 'https://x/owl.jpg' }]);

  const fallback = await loadDemoPhotos((async (url: string) => url === '/v1/demo/photos'
    ? json({ photos: [] })
    : json({ fallback: [{ id: 'dusk', src: 'photos/dusk.webp', title: { 'en-GB': 'Bird at dusk' } }, { id: 'bad', src: '../evil.webp', title: 'x' }] })) as unknown as typeof fetch);
  assert.deepEqual(fallback, [{ id: 'illustration-dusk', title: 'Bird at dusk (sample illustration)', url: '/demo/photos/dusk.webp' }]);
});

test('an unreachable service gives no photos rather than an error, and a bad image is skipped', async () => {
  assert.deepEqual(await loadDemoPhotos((async () => { throw new Error('offline'); }) as unknown as typeof fetch), []);
  const files = await fetchDemoFiles([{ id: 'a', title: 'Good', url: '/a' }, { id: 'b', title: 'Not an image', url: '/b' }, { id: 'c', title: 'Missing', url: '/c' }],
    (async (url: string) => url === '/a' ? { ok: true, blob: async () => new Blob(['x'], { type: 'image/webp' }) } : url === '/b' ? { ok: true, blob: async () => new Blob(['x'], { type: 'text/html' }) } : { ok: false }) as unknown as typeof fetch);
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'Good.webp');
});
