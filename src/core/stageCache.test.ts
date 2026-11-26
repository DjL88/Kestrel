import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCanvasPhotoEdit } from './canvasEdit';
import { createStageCache } from './stageCache';
import { DEFAULT_EDIT, type PhotoEdit } from './photoEdits';
import { createMask } from './maskTypes';

// Node has no ImageData; noise reduction constructs one to put its result back.
(globalThis as { ImageData?: unknown }).ImageData ??= class {
  constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
};

/** Pixel-preserving canvas double with a textured, noisy picture, counting whole-picture reads. */
function canvasDouble(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const x = (i / 4) % width;
    const noise = (seed % 31) - 15;
    data[i] = Math.max(0, Math.min(255, 60 + (x * 3) % 140 + noise));
    data[i + 1] = Math.max(0, Math.min(255, 90 + noise));
    data[i + 2] = Math.max(0, Math.min(255, 150 - (x % 90) + noise));
    data[i + 3] = 255;
  }
  let wholeReads = 0;
  const context = {
    getImageData(_x: number, y: number, w: number, h: number) {
      if (h === height && w === width) wholeReads++;
      const pixels = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row++) pixels.set(data.subarray(((y + row) * width) * 4, ((y + row) * width + w) * 4), row * w * 4);
      return { data: pixels, width: w, height: h };
    },
    putImageData(image: { data: Uint8ClampedArray; width: number; height: number }, _x: number, y: number) {
      for (let row = 0; row < image.height; row++) data.set(image.data.subarray(row * image.width * 4, (row + 1) * image.width * 4), ((y + row) * width) * 4);
    },
  };
  return Object.assign({ width, height, data, getContext: () => context, reads: () => wholeReads }) as unknown as HTMLCanvasElement & { data: Uint8ClampedArray; reads(): number };
}

const early: PhotoEdit = { ...DEFAULT_EDIT, denoise: 1.2, denoiseLuminance: 0.8, dehaze: 0.4, captureSharpen: { amount: 0.6, profile: 'generic' } as PhotoEdit['captureSharpen'] };

/** A drag: the same early settings, a late slider moving, then an early slider moving. */
const drag: PhotoEdit[] = [
  early,
  { ...early, exposure: 0.3 },
  { ...early, exposure: 0.6, contrast: 20 },
  { ...early, exposure: 0.6, contrast: 20, masks: [{ ...createMask('radial', 'subject'), edit: { exposure: 0.5 } }] },
  { ...early, exposure: 0.6, dehaze: 0.5 },
  { ...early, exposure: 0.6, dehaze: 0.5, warmth: 10 },
  { ...early, denoise: 0.6, exposure: 0.6 },
  { ...early, exposure: -0.2 },
];

test('every cached render matches a full render pixel for pixel, through a drag of late and early sliders', () => {
  for (const edge of [undefined, 8000]) {
    const cache = createStageCache(64 * 1024 * 1024);
    for (const edit of drag) {
      const full = canvasDouble(96, 64);
      const cached = canvasDouble(96, 64);
      applyCanvasPhotoEdit(full, edit, edge);
      applyCanvasPhotoEdit(cached, edit, edge, undefined, { cache, sourceKey: 'photo-a' });
      assert.deepEqual(cached.data, full.data, JSON.stringify({ edge, edit }));
    }
    assert.ok(cache.stats().hits >= 5, `hits ${cache.stats().hits}`);
  }
});

test('a late slider skips every early stage; an early slider re-runs only from its stage', () => {
  const cache = createStageCache(64 * 1024 * 1024);
  const use = { cache, sourceKey: 'photo-a' };
  // The whole photo's long edge: large enough that capture sharpening does something on this small canvas.
  const EDGE = 8000;
  applyCanvasPhotoEdit(canvasDouble(96, 64), early, EDGE, undefined, use);
  const entries = cache.stats().entries; // noise, dehaze, capture
  assert.equal(entries, 3);
  const before = cache.stats();
  applyCanvasPhotoEdit(canvasDouble(96, 64), { ...early, exposure: 0.4 }, EDGE, undefined, use);
  assert.equal(cache.stats().hits, before.hits + 1);
  assert.equal(cache.stats().entries, entries, 'nothing re-run, nothing new stored');
  applyCanvasPhotoEdit(canvasDouble(96, 64), { ...early, dehaze: 0.7 }, EDGE, undefined, use);
  // Noise reduction was reused; dehaze and capture ran and were stored under new keys.
  assert.equal(cache.stats().entries, entries + 2);
});

test('another photo, size or scale never reuses a stage', () => {
  const cache = createStageCache(64 * 1024 * 1024);
  applyCanvasPhotoEdit(canvasDouble(96, 64), early, undefined, undefined, { cache, sourceKey: 'photo-a' });
  const hits = cache.stats().hits;
  applyCanvasPhotoEdit(canvasDouble(96, 64), early, undefined, undefined, { cache, sourceKey: 'photo-b' });
  applyCanvasPhotoEdit(canvasDouble(80, 64), early, undefined, undefined, { cache, sourceKey: 'photo-a' });
  applyCanvasPhotoEdit(canvasDouble(96, 64), early, 400, undefined, { cache, sourceKey: 'photo-a' });
  assert.equal(cache.stats().hits, hits);
});

test('the cache keeps within its byte limit, dropping the least recently used picture first', () => {
  const cache = createStageCache(250);
  const snap = (n: number) => ({ data: new Uint8ClampedArray(n), width: 1, height: 1 });
  cache.set('a', snap(100));
  cache.set('b', snap(100));
  cache.get('a');
  cache.set('c', snap(100));
  assert.equal(cache.get('b'), undefined);
  assert.ok(cache.get('a') && cache.get('c'));
  assert.ok(cache.stats().bytes <= 250);
  cache.set('huge', snap(300));
  assert.equal(cache.get('huge'), undefined, 'larger than the whole limit: not kept');
  assert.equal(cache.stats().entries, 2);
});

test('no early stage, or no cache, renders exactly as before', () => {
  const cache = createStageCache(64 * 1024 * 1024);
  const tone = { ...DEFAULT_EDIT, exposure: 0.5 };
  const full = canvasDouble(48, 32);
  const cached = canvasDouble(48, 32);
  applyCanvasPhotoEdit(full, tone);
  applyCanvasPhotoEdit(cached, tone, undefined, undefined, { cache, sourceKey: 'x' });
  assert.deepEqual(cached.data, full.data);
  assert.equal(cache.stats().entries, 0);
});
