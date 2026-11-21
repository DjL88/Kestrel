import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDemoShootState } from '../core/cullingEngine';
import { EXPORT_PROFILES } from '../core/exportProfiles';
import { drawCropQuickly, loadExportSource, renderExport, renderExportPreview } from './browserExport';

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

test('drag-time crop preview rejects invalid RAW decoder dimensions before touching target canvas', () => {
  const frame = { ...createDemoShootState(1).frames[0], filename: 'Z8-HE.NEF', isDemo: false };
  const master = EXPORT_PROFILES.find(({ id }) => id === 'master')!;
  const target = {
    set width(_value: number) { throw new Error('target modified'); },
    set height(_value: number) { throw new Error('target modified'); },
    getContext() { throw new Error('canvas context requested'); },
  } as unknown as HTMLCanvasElement;
  for (const [width, height] of [
    [0, 5504], [-1, 5504], [8256.5, 5504],
    [8256, NaN], [Infinity, 5504], [8256, 0],
  ]) {
    const source = { naturalWidth: width, naturalHeight: height } as HTMLImageElement;
    assert.throws(() => drawCropQuickly(source, frame, master, {}, target), /invalid pixel dimensions/);
  }
});


test('export rejects an empty encoded file rather than saving a corrupt master', async (t) => {
  const saved = new Map(['document', 'navigator'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, value: { userAgent: 'desktop', platform: 'Win32', maxTouchPoints: 0 },
  });
  const context = { resetTransform() {}, clearRect() {}, scale() {}, translate() {}, rotate() {}, drawImage() {} };
  let attempts = 0;
  let canvas: { width: number; height: number } | undefined;
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: {
      createElement() {
        canvas = {
          width: 0, height: 0,
          getContext: () => context,
          toBlob(callback: (value: Blob) => void) {
            attempts++;
            callback(new Blob([], { type: 'image/png' }));
          },
        } as typeof canvas;
        return canvas;
      },
    },
  });
  const frame = createDemoShootState(1).frames[0];
  const master = EXPORT_PROFILES.find(({ id }) => id === 'master')!;
  await assert.rejects(
    renderExport({ naturalWidth: 640, naturalHeight: 480 } as HTMLImageElement, frame, master, new Date()),
    /Could not encode/,
  );
  assert.equal(attempts, 1, 'do not retry a zero-byte encoder result as if it were valid');
  assert.equal(canvas?.width, 0, 'release allocated canvas on failure');
  assert.equal(canvas?.height, 0);
});

test('previewless RAW uses Kite44 sensor development for export, without a second photo app', async (t) => {
  const previousImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const previousObjectUrl = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  t.after(() => {
    if (previousImage) Object.defineProperty(globalThis, 'Image', previousImage);
    else Reflect.deleteProperty(globalThis, 'Image');
    URL.createObjectURL = previousObjectUrl;
    URL.revokeObjectURL = previousRevoke;
  });
  const revoked: string[] = [];
  URL.createObjectURL = () => 'blob:kestrel-raw-export';
  URL.revokeObjectURL = url => revoked.push(url);
  class ImageStub {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private address = '';
    get src() { return this.address; }
    set src(value: string) { this.address = value; queueMicrotask(() => this.onload?.()); }
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: ImageStub });
  const raw = new Blob(['unaltered original'], { type: 'application/octet-stream' });
  const frame = { ...createDemoShootState(1).frames[0], filename: 'missing-preview.NEF', stableKey: 'raw', isDemo: false };
  let reads = 0;
  const result = await loadExportSource(frame, {
    getFullPreviewUrl: async () => '',
    hasBlob: () => true,
    ensureOriginal: async () => { reads++; return raw; },
  }, 'selected', async (source, extension) => {
    assert.equal(source, raw);
    assert.equal(extension, 'nef');
    return new Blob(['developed'], { type: 'image/jpeg' });
  });
  assert.equal((result as HTMLImageElement).src, 'blob:kestrel-raw-export');
  assert.equal(reads, 1);
  assert.deepEqual(revoked, ['blob:kestrel-raw-export']);
});

test('RAW preview cache cannot be exported without original identity even when a decoder exists', async () => {
  const frame = { ...createDemoShootState(1).frames[0], filename: 'disconnected.NEF', stableKey: 'missing', isDemo: false };
  let decodes = 0;
  await assert.rejects(loadExportSource(frame, {
    getFullPreviewUrl: async () => 'blob:review-cache',
    hasBlob: () => true,
    isOfflineFallback: () => true,
    ensureOriginal: async () => undefined,
  }, 'selected', async () => {
    decodes++;
    return new Blob(['fake'], { type: 'image/jpeg' });
  }), /Reconnect disconnected.NEF/);
  assert.equal(decodes, 0, 'never export a stale review thumbnail when the original is absent');
});


/** The sensor decoder must outrank a perfectly usable but lower-fidelity embedded JPEG on export. */
function stubExportImage(t: { after(callback: () => void): void }) {
  const oldImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const oldCreate = URL.createObjectURL;
  const oldRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  t.after(() => {
    if (oldImage) Object.defineProperty(globalThis, 'Image', oldImage);
    else Reflect.deleteProperty(globalThis, 'Image');
    URL.createObjectURL = oldCreate;
    URL.revokeObjectURL = oldRevoke;
  });
  URL.createObjectURL = () => 'blob:sensor-development';
  URL.revokeObjectURL = url => { revoked.push(url); };
  class ImageStub {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private address = '';
    get src() { return this.address; }
    set src(value: string) { this.address = value; queueMicrotask(() => this.onload?.()); }
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: ImageStub });
  return { revoked };
}

test('available RAW sensor development outranks an embedded JPEG export preview', async (t) => {
  const { revoked } = stubExportImage(t);
  const original = new Blob(['original sensor samples']);
  const frame = { ...createDemoShootState(1).frames[0], filename: 'Z8.NEF', stableKey: 'camera-z8', isDemo: false };
  let decodes = 0;
  const image = await loadExportSource(frame, {
    getFullPreviewUrl: async () => 'blob:embedded-camera-jpeg',
    hasBlob: () => true, isOfflineFallback: () => false,
    isDeveloped: () => false,
    ensureOriginal: async () => original,
    getOriginal: () => original,
  }, 'selected', async (source, extension) => {
    decodes++;
    assert.equal(source, original);
    assert.equal(extension, 'nef');
    return new Blob(['sensor-derived JPEG'], { type: 'image/jpeg' });
  });
  assert.equal(decodes, 1);
  assert.equal(image.src, 'blob:sensor-development');
  assert.deepEqual(revoked, ['blob:sensor-development']);
});

test('an existing current RAW development is reused without decoding again', async (t) => {
  stubExportImage(t);
  const frame = { ...createDemoShootState(1).frames[0], filename: 'Z8.NEF', stableKey: 'ready-raw', isDemo: false };
  const image = await loadExportSource(frame, {
    getFullPreviewUrl: async () => 'blob:already-developed',
    hasBlob: () => true, isDeveloped: () => true,
  }, 'selected', async () => { throw new Error('Must not decode a current source again'); });
  assert.equal(image.src, 'blob:already-developed');
});

test('missing or relinked RAW original never falls back to a stale embedded JPEG', async (t) => {
  stubExportImage(t);
  const frame = { ...createDemoShootState(1).frames[0], filename: 'Z5II.NEF', stableKey: 'relinked', isDemo: false };
  const original = new Blob(['first source']);
  let active = original;
  const provider = {
    getFullPreviewUrl: async () => 'blob:old-camera-jpeg',
    hasBlob: () => true, isDeveloped: () => false,
    ensureOriginal: async () => original,
    getOriginal: () => active,
  };
  const decode = async () => {
    active = new Blob(['new original after a drive relink']);
    return new Blob(['stale development'], { type: 'image/jpeg' });
  };
  await assert.rejects(loadExportSource(frame, provider, 'selected', decode), /changed during RAW development/);
  active = original;
  await assert.rejects(loadExportSource(frame, { ...provider, ensureOriginal: async () => undefined },
    'selected', decode), /Reconnect Z5II.NEF/);
});


test('concurrent RAW edit and export requests share one sensor decode and reuse its result', async (t) => {
  stubExportImage(t);
  const frame = { ...createDemoShootState(1).frames[0], filename: 'Dunnock.NEF', stableKey: 'shared-raw', isDemo: false };
  const original = new Blob(['sensor samples']);
  let developed = false;
  let calls = 0;
  let resume!: () => void;
  const blocked = new Promise<void>(resolve => { resume = resolve; });
  const provider = {
    getFullPreviewUrl: async () => developed ? 'blob:current-sensor' : 'blob:camera-preview',
    hasBlob: () => true,
    isDeveloped: () => developed,
    ensureOriginal: async () => original,
    getOriginal: () => original,
    developFromOriginal: async (_key: string, decode: (file: Blob) => Promise<Blob>) => {
      calls++;
      await blocked;
      await decode(original);
      developed = true;
      return 'ready' as const;
    },
  };
  const decoder = async () => new Blob(['full pixels'], { type: 'image/jpeg' });
  const first = loadExportSource(frame, provider, 'selected', decoder);
  const second = loadExportSource(frame, provider, 'selected', decoder);
  resume();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.src, 'blob:current-sensor');
  assert.equal(b.src, 'blob:current-sensor');
  assert.equal(calls, 1, 'only one RAW decode should be scheduled');
  const third = await loadExportSource(frame, provider, 'selected', decoder);
  assert.equal(third.src, 'blob:current-sensor');
  assert.equal(calls, 1, 'subsequent edits must reuse the developed pixels');
});
