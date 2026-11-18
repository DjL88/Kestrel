import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoShootState } from '../core/cullingEngine';
import { EXPORT_PROFILES } from '../core/exportProfiles';
import { loadExportSource, renderExport, renderExportPreview } from './browserExport';

test('cancelling an export skips unused canvas work and discards an encoded result', async (t) => {
  const controller = new AbortController();
  const context = {
    resetTransform() {}, clearRect() {}, scale() {}, translate() {}, rotate() {}, drawImage() {},
  };
  let allocated = 0;
  let encodes = 0;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob(callback: (value: Blob) => void) {
      encodes += 1;
      controller.abort();
      callback(new Blob(['synthetic'], { type: 'image/png' }));
    },
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement() { allocated += 1; return canvas; } },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  const source = { naturalWidth: 640, naturalHeight: 480 } as HTMLImageElement;
  const frame = createDemoShootState(1).frames[0];
  const profile = EXPORT_PROFILES.find(({ id }) => id === 'master')!;
  const now = new Date();
  await assert.rejects(renderExport(source, frame, profile, now, AbortSignal.abort()), { name: 'AbortError' });
  assert.equal(allocated, 0);
  await assert.rejects(renderExport(source, frame, profile, now, controller.signal), { name: 'AbortError' });
  assert.equal(encodes, 1);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
});


test('Nikon export distinguishes missing originals from originals without usable previews', async () => {
  let attached = false;
  const provider = { getFullPreviewUrl: async () => '', hasBlob: () => attached };
  for (const filename of ['Z8.NEF', 'previewless.NRW']) {
    const frame = {
      ...createDemoShootState(1).frames[0],
      id: filename, stableKey: filename, filename, isDemo: false, sourceKind: 'file' as const,
    };
    attached = false;
    await assert.rejects(loadExportSource(frame, provider), /Reconnect/);
    attached = true;
    await assert.rejects(loadExportSource(frame, provider), /no usable embedded JPEG/);
  }
});

test('exports retain requested dimensions or fail explicitly; only previews may shrink', async (t) => {
  const originals = new Map(['document', 'navigator'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  let allocated = 0;
  const encodedSizes: number[][] = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, value: { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 5 },
  });
  const context = {
    resetTransform() {}, clearRect() {}, scale() {}, translate() {}, rotate() {}, drawImage() {},
  };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement() {
        allocated += 1;
        return {
          width: 0, height: 0, getContext: () => context,
          toBlob(callback: (value: Blob) => void) {
            encodedSizes.push([this.width, this.height]);
            callback(new Blob(['synthetic'], { type: 'image/png' }));
          },
        };
      },
    },
  });
  const frame = createDemoShootState(1).frames[0];
  const master = EXPORT_PROFILES.find(({ id }) => id === 'master')!;
  const source = { naturalWidth: 8256, naturalHeight: 5504 } as HTMLImageElement;
  const now = new Date();
  await assert.rejects(renderExport(source, frame, master, now), /8256 × 5504 px.*No smaller file was substituted/);
  // Preview-only options cannot accidentally reduce a real export either.
  await assert.rejects(renderExport(source, frame, master, now, undefined, 'fit', undefined, { previewEdge: 240 }), /cannot safely export/);
  const oversizedBorder = { ...master, width: 6000, height: 6000 };
  await assert.rejects(renderExport(source, frame, oversizedBorder, now, undefined, 'border'), /6000 × 6000 px/);
  await assert.rejects(renderExport({ naturalWidth: 4096, naturalHeight: 4097 } as HTMLImageElement, frame, master, now), /cannot safely export/);
  assert.equal(allocated, 0, 'reject before allocating a large canvas');
  assert.equal(encodedSizes.length, 0);

  const preview = await renderExportPreview(source, frame, master, 'fit');
  assert.deepEqual([preview.width, preview.height], [240, 160]);
  // A chosen smaller size succeeds without further hidden downscaling.
  await renderExport(source, frame, { ...master, width: 2048, height: 2048 }, now);
  const cropped = { ...frame, framing: { ratio: 1, x: 0.5, y: 0.5, turns: 0 as const, straighten: 0, size: 0.5 } };
  await renderExport(source, cropped, master, now);
  await renderExport({ naturalWidth: 4096, naturalHeight: 4096 } as HTMLImageElement, frame, master, now);
  Object.defineProperty(navigator, 'userAgent', { value: 'desktop' });
  await renderExport(source, frame, master, now);
  assert.deepEqual(encodedSizes, [[2048, 1365], [2752, 2752], [4096, 4096], [8256, 5504]]);
});

test('export refuses cached offline review even when it has a valid preview URL', async () => {
  const frame = {
    ...createDemoShootState(1).frames[0],
    filename: 'Z8.NEF', stableKey: 'offline-Z8', isDemo: false, sourceKind: 'file' as const,
  };
  const provider = {
    getFullPreviewUrl: async () => 'blob:offline-review',
    hasBlob: () => true,
    isOfflineFallback: () => true,
  };
  await assert.rejects(loadExportSource(frame, provider), /Reconnect Z8.NEF before exporting.*not the original photograph/);
});
test('a reconnected source is not mistaken for an offline review', async () => {
  const frame = {
    ...createDemoShootState(1).frames[0],
    filename: 'Z8.NEF', stableKey: 'online-Z8', isDemo: false, sourceKind: 'file' as const,
  };
  const provider = {
    getFullPreviewUrl: async () => '',
    hasBlob: () => true,
    isOfflineFallback: () => false,
  };
  await assert.rejects(loadExportSource(frame, provider), /no usable embedded JPEG/);
});


test('export and preview fail closed for corrupt decoded source dimensions without allocating a canvas', async (t) => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  let allocations = 0;
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: { createElement() { allocations++; throw new Error('Unexpected canvas allocation'); } },
  });
  const frame = { ...createDemoShootState(1).frames[0], filename: 'NIKON-Z8.NEF', isDemo: false };
  const master = EXPORT_PROFILES.find(({ id }) => id === 'master')!;
  for (const [width, height] of [
    [0, 4000], [4000, 0], [-1, 4000], [NaN, 4000],
    [Infinity, 4000], [4000, Infinity], [4000.5, 4000],
  ]) {
    const source = { naturalWidth: width, naturalHeight: height } as HTMLImageElement;
    await assert.rejects(renderExport(source, frame, master, new Date()), /invalid pixel dimensions/);
    await assert.rejects(renderExportPreview(source, frame, master, 'fit'), /invalid pixel dimensions/);
  }
  assert.equal(allocations, 0);
});
