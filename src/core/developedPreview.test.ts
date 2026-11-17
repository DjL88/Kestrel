import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import { previewCacheKey } from '../providers/offlinePreviewCache';
import type { PhotoFrame } from './types';

const jpeg = new Uint8Array(await readFile(new URL('../assets/images/demo_red_kite_flight_1794721996053.jpg', import.meta.url)));
// A synthetic container exercises embedded-preview extraction without a personal RAW file.
const raw = () => new Blob([new Uint8Array(64), jpeg]);
function frame(id: string, stableKey = 'synthetic-z8'): PhotoFrame {
  return {
    id, stableKey, filename: 'Z8.NEF', sequenceIndex: 1, decision: 'keep',
    burstGroupId: null, burstIndex: 1, burstCount: 1, exif: {}, isDemo: false, sourceKind: 'file',
  };
}

test('developing a RAW switches every cached virtual copy to the same full-size source', async (t) => {
  const provider = new BrowserPreviewProvider();
  t.after(() => provider.clear());
  const original = raw();
  const first = frame('original');
  const copy = { ...frame('copy'), virtualCopy: { originalFrameId: first.id, number: 1 } };
  provider.registerBlob(first.stableKey, original);
  const [beforeA, beforeB] = await Promise.all([provider.getFullPreviewUrl(first), provider.getFullPreviewUrl(copy)]);
  assert.equal(beforeA, beforeB, 'virtual copies share a single unedited source URL');
  assert.deepEqual(new Uint8Array(await (await fetch(beforeA)).arrayBuffer()), jpeg);
  assert.equal(await provider.developFromOriginal(first.stableKey, async () => new Blob(['full-size developed result'], { type: 'image/jpeg' })), 'ready');
  const [afterA, afterB] = await Promise.all([provider.getFullPreviewUrl(first), provider.getFullPreviewUrl(copy)]);
  assert.notEqual(afterA, beforeA);
  assert.equal(afterA, afterB);
  assert.equal(await (await fetch(afterB)).text(), 'full-size developed result');
  assert.equal(provider.getOriginal(first.stableKey), original, 'RAW original is retained separately');
  assert.equal(copy.virtualCopy.originalFrameId, first.id);
});

test('clearing a project releases developed sources and relinking cannot reuse an obsolete render', async (t) => {
  const provider = new BrowserPreviewProvider();
  t.after(() => provider.clear());
  const photo = frame('original');
  provider.registerBlob(photo.stableKey, raw());
  assert.equal(await provider.developFromOriginal(photo.stableKey, async () => new Blob(['old development'])), 'ready');
  await provider.getFullPreviewUrl(photo);
  provider.registerBlob(photo.stableKey, raw());
  assert.equal(provider.isDeveloped(photo.stableKey), false);
  assert.deepEqual(new Uint8Array(await (await fetch(await provider.getFullPreviewUrl(photo))).arrayBuffer()), jpeg);
  assert.equal(await provider.developFromOriginal(photo.stableKey, async () => new Blob(['new development'])), 'ready');
  provider.clear();
  assert.equal(provider.isDeveloped(photo.stableKey), false);
  assert.equal(provider.getOriginal(photo.stableKey), undefined);
  assert.equal(await provider.getFullPreviewUrl(photo), '');
});

test('releasing one virtual copy keeps the source usable by another copy', async (t) => {
  const provider = new BrowserPreviewProvider();
  t.after(() => provider.clear());
  const photo = frame('original');
  provider.registerBlob(photo.stableKey, raw());
  assert.equal(await provider.developFromOriginal(photo.stableKey, async () => new Blob(['shared development'])), 'ready');
  const url = await provider.getFullPreviewUrl(photo);
  assert.equal(await provider.getFullPreviewUrl(frame('copy')), url);
  provider.releaseFrame(photo.id);
  assert.equal(await (await fetch(url)).text(), 'shared development');
  assert.equal(await provider.getFullPreviewUrl(frame('copy')), url);
  provider.releaseFrame('copy');
  await assert.rejects(fetch(url), 'the final release revokes the source URL');
});

function delayedRaw() {
  const blob = raw();
  const slice = blob.slice.bind(blob);
  let started!: () => void;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { started = resolve; });
  const released = new Promise<void>((resolve) => { resume = resolve; });
  blob.slice = (...args) => {
    const part = slice(...args);
    const bytes = part.arrayBuffer.bind(part);
    part.arrayBuffer = async () => { started(); await released; return bytes(); };
    return part;
  };
  return { blob, waiting, resume };
}

test('a late embedded-preview read cannot replace a successful RAW development', async (t) => {
  const provider = new BrowserPreviewProvider();
  t.after(() => provider.clear());
  const photo = frame('original');
  const slow = delayedRaw();
  provider.registerBlob(photo.stableKey, slow.blob);
  const pending = provider.getFullPreviewUrl(photo);
  await slow.waiting;
  assert.equal(await provider.developFromOriginal(photo.stableKey, async () => new Blob(['developed while reading'])), 'ready');
  slow.resume();
  const url = await pending;
  assert.equal(await (await fetch(url)).text(), 'developed while reading');
  assert.equal(await provider.getFullPreviewUrl(frame('copy')), url);
});

test('a late preview read cannot refill a cleared project cache', async () => {
  const provider = new BrowserPreviewProvider();
  const photo = frame('original');
  const slow = delayedRaw();
  provider.registerBlob(photo.stableKey, slow.blob);
  const pending = provider.getFullPreviewUrl(photo);
  await slow.waiting;
  provider.clear();
  slow.resume();
  assert.equal(await pending, '');
  assert.equal(await provider.getFullPreviewUrl(photo), '');
});

test('cached offline previews remain available after reopening when a linked original cannot be read', async (t) => {
  const persisted = new Map<string, { thumbnail: Blob; review: Blob }>();
  const cache = {
    async savePreviewPair(key: string, previews: { thumbnail: Blob; review: Blob }) {
      persisted.set(key, previews);
      return true;
    },
    async loadPreviewPair(key: string) {
      return persisted.get(key) ?? null;
    },
  };
  const photo = frame('original');
  const cacheKey = previewCacheKey({
    stableKey: photo.stableKey, filename: photo.filename, fileSize: 1024, lastModified: 1,
  });
  await cache.savePreviewPair(cacheKey, {
    thumbnail: new Blob(['cached thumbnail']),
    review: new Blob(['cached review']),
  });

  const provider = new BrowserPreviewProvider(cache);
  t.after(() => provider.clear());
  provider.registerLinked(photo.stableKey, {
    read: async () => { throw new Error('source volume is disconnected'); },
    size: 1024,
    lastModified: 1,
  });

  const thumbnailUrl = await provider.getThumbnailUrl(photo);
  const reviewUrl = await provider.getFullPreviewUrl(photo);
  assert.equal(await (await fetch(thumbnailUrl)).text(), 'cached thumbnail');
  assert.equal(await (await fetch(reviewUrl)).text(), 'cached review');
});

test('linked originals generate a small thumbnail and bounded review preview without caching the source', async (t) => {
  const originals = new Map([
    ['createImageBitmap', Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap')],
    ['document', Object.getOwnPropertyDescriptor(globalThis, 'document')],
  ]);
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  const dimensions: string[] = [];
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => ({ width: 8256, height: 5504, close() {} }),
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage() {} }),
          toBlob: (callback: (blob: Blob) => void) => {
            const size = `${canvas.width}x${canvas.height}`;
            dimensions.push(size);
            callback(new Blob([size], { type: 'image/jpeg' }));
          },
        };
        return canvas;
      },
    },
  });

  let saved: { thumbnail: Blob; review: Blob } | undefined;
  const provider = new BrowserPreviewProvider({
    async savePreviewPair(_key, previews) { saved = previews; return true; },
    async loadPreviewPair() { return saved ?? null; },
  });
  assert.equal(await provider.cacheOfflinePreviews('linked-photo', 'photo.jpg', new Blob(['original'])), true);
  assert.deepEqual(dimensions, ['400x267', '2200x1467']);
  assert.equal(await saved?.thumbnail.text(), '400x267');
  assert.equal(await saved?.review.text(), '2200x1467');
});

test('relinking a changed original invalidates its previous RAW development', async (t) => {
  const provider = new BrowserPreviewProvider();
  t.after(() => provider.clear());
  const photo = frame('relinked');
  provider.registerLinked(photo.stableKey, { read: async () => raw(), size: 100, lastModified: 1 });
  assert.equal(await provider.developFromOriginal(photo.stableKey, async () => new Blob(['old sensor development'], { type: 'image/jpeg' })), 'ready');
  assert.equal(provider.isDeveloped(photo.stableKey), true);
  provider.registerLinked(photo.stableKey, { read: async () => raw(), size: 200, lastModified: 2 });
  assert.equal(provider.isDeveloped(photo.stableKey), false);
  assert.deepEqual(new Uint8Array(await (await fetch(await provider.getFullPreviewUrl(photo))).arrayBuffer()), jpeg);
});

test('a slow previous drive read cannot overwrite a newly linked original', async (t) => {
  const provider = new BrowserPreviewProvider();
  t.after(() => provider.clear());
  const photo = frame('relinked-slow');
  let release!: (blob: Blob) => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => { started = resolve; });
  const oldRead = new Promise<Blob>((resolve) => { release = resolve; });
  provider.registerLinked(photo.stableKey, {
    read: async () => { started(); return oldRead; }, size: 100, lastModified: 1,
  });
  const pending = provider.ensureOriginal(photo.stableKey);
  await waiting;
  const fresh = new Blob(['new original']);
  provider.registerLinked(photo.stableKey, { read: async () => fresh, size: 200, lastModified: 2 });
  assert.equal(await provider.ensureOriginal(photo.stableKey), fresh);
  release(new Blob(['stale original']));
  assert.equal(await pending, undefined);
  assert.equal(provider.getOriginal(photo.stableKey), fresh);
});

test('retrying a linked original invalidates a previously developed result', async (t) => {
  const provider = new BrowserPreviewProvider();
  t.after(() => provider.clear());
  const photo = frame('retry');
  provider.registerLinked(photo.stableKey, { read: async () => raw(), size: 100, lastModified: 1 });
  assert.equal(await provider.developFromOriginal(photo.stableKey, async () => new Blob(['old development'])), 'ready');
  provider.retryLinkedOriginal(photo.stableKey);
  assert.equal(provider.isDeveloped(photo.stableKey), false);
});

for (const change of ['relink', 'retry', 'replace', 'clear'] as const) {
  test(`a pending Nikon RAW decode cannot replace the source after ${change}`, async (t) => {
    const provider = new BrowserPreviewProvider();
    t.after(() => provider.clear());
    const photo = frame('z8');
    const key = photo.stableKey;
    const original = raw();
    const replacement = raw();
    const linked = change === 'retry' || change === 'relink';
    if (linked) provider.registerLinked(key, { read: async () => original, size: original.size, lastModified: 1 });
    else provider.registerBlob(key, original);

    let start!: (source: Blob) => void;
    let finish!: (picture: Blob) => void;
    const started = new Promise<Blob>((resolve) => { start = resolve; });
    const decoded = new Promise<Blob>((resolve) => { finish = resolve; });
    const pending = provider.developFromOriginal(key, (source) => { start(source); return decoded; });
    assert.equal(await started, original);

    if (change === 'clear') provider.clear();
    if (change === 'retry') provider.retryLinkedOriginal(key);
    if (change === 'replace') provider.registerBlob(key, replacement);
    if (change === 'relink') provider.registerLinked(key, { read: async () => replacement, size: replacement.size, lastModified: 2 });

    finish(new Blob(['stale native rendering'], { type: 'image/jpeg' }));
    assert.equal(await pending, 'superseded');
    assert.equal(provider.isDeveloped(key), false);
    if (change === 'clear') {
      assert.equal(await provider.getFullPreviewUrl(photo), '');
    } else {
      const expected = change === 'retry' ? original : replacement;
      assert.equal(await provider.ensureOriginal(key), expected);
      const preview = await provider.getFullPreviewUrl(photo);
      assert.deepEqual(new Uint8Array(await (await fetch(preview)).arrayBuffer()), jpeg);
      assert.equal(await provider.developFromOriginal(key, async () => new Blob(['fresh native rendering'])), 'ready');
      assert.equal(await (await fetch(await provider.getFullPreviewUrl(photo))).text(), 'fresh native rendering');
    }
  });
}
