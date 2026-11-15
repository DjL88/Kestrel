import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import type { BrowserCatalogueStore } from '../src/providers/browserCatalogueStore';
import { createEmptyProject } from '../src/core/projects';
import type { PhotoFrame } from '../src/core/types';

declare global {
  interface Window {
    catalogueTest: { BrowserCatalogueStore: typeof BrowserCatalogueStore };
  }
}

// Exercise the real store against browser IndexedDB, without app autosaves or personal photos.
let storeBundle: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false, logLevel: 'silent',
    build: {
      write: false, minify: false,
      lib: {
        entry: fileURLToPath(new URL('../src/providers/browserCatalogueStore.ts', import.meta.url)),
        name: 'catalogueTest', formats: ['iife'],
      },
    },
  });
  const output = (Array.isArray(result) ? result[0] : result) as { output: { type: string; code?: string }[] };
  storeBundle = output.output.find((item) => item.type === 'chunk')!.code!;
});

test.beforeEach(async ({ page }) => {
  await page.route('**/catalogue-test', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Catalogue test</title>' }));
  await page.goto('/catalogue-test');
  await page.addScriptTag({ content: storeBundle });
});

function project(id: string, keys: string[]) {
  const state = createEmptyProject(id, id);
  state.frames = keys.map((key, index): PhotoFrame => ({
    id: `${id}-${index}`, stableKey: key, filename: `${key}.NEF`, sequenceIndex: index,
    decision: 'keep', sourceKind: 'file', isDemo: false, exif: {},
    burstGroupId: null, burstIndex: 1, burstCount: 1,
  }));
  return state;
}

test('delete and subsequent save keep their call order', async ({ page }) => {
  const source = project('source', ['shared']);
  const result = await page.evaluate(async (source) => {
    const store = new window.catalogueTest.BrowserCatalogueStore();
    await store.saveProject(source);
    const deletion = store.deleteProject(source.shoot.id);
    const save = store.saveProject({ ...source, frames: [], shoot: { ...source.shoot, title: 'New catalogue' } });
    await Promise.all([deletion, save]);
    return (await store.loadProject(source.shoot.id))?.shoot.title;
  }, source);
  expect(result).toBe('New catalogue');
});

test('a catalogue committed ahead of deletion protects its shared original', async ({ page }) => {
  const source = project('source', ['shared', 'unique']);
  const target = project('restored-backup', ['shared']);
  // Archived and removed photos must remain recoverable, including virtual copies.
  target.shoot.archivedAt = 1000;
  target.frames[0].removedAt = 1000;
  target.frames.push({ ...target.frames[0], id: 'virtual-copy', virtualCopy: { originalFrameId: target.frames[0].id, number: 1 } });
  const result = await page.evaluate(async ({ source, target }) => {
    const store = new window.catalogueTest.BrowserCatalogueStore();
    await store.saveProject(source);
    await store.saveLocalFileBlob('shared', new Blob(['synthetic Nikon original']));
    await store.saveLocalFileBlob('unique', new Blob(['synthetic unshared original']));
    const original = IDBDatabase.prototype.transaction;
    let concurrentSave = false;
    IDBDatabase.prototype.transaction = function (names, mode, options) {
      if (!concurrentSave && mode === 'readwrite' && Array.isArray(names) && names.includes('localFiles')) {
        concurrentSave = true;
        // Another connection's catalogue write can be queued just before the delete transaction.
        original.call(this, 'catalogue', 'readwrite').objectStore('catalogue').put(target, `project:${target.shoot.id}`);
      }
      return original.call(this, names, mode, options);
    };
    try { await store.deleteProject(source.shoot.id); }
    finally { IDBDatabase.prototype.transaction = original; }
    return {
      concurrentSave,
      source: await store.loadProject(source.shoot.id),
      target: await store.loadProject(target.shoot.id),
      shared: await (await store.loadLocalFileBlob('shared'))?.text(),
      unique: await store.loadLocalFileBlob('unique'),
    };
  }, { source, target });
  expect(result.concurrentSave).toBe(true);
  expect(result.source).toBeNull();
  expect(result.target).toEqual(target);
  expect(result.shared).toBe('synthetic Nikon original');
  expect(result.unique).toBeNull();
});

test('an interrupted deletion rolls back catalogue and photo changes and allows retry', async ({ page }) => {
  const result = await page.evaluate(async (source) => {
    const store = new window.catalogueTest.BrowserCatalogueStore();
    await store.saveProject(source);
    await store.saveLocalFileBlob('unique', new Blob(['untouched original']));
    const original = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (key) {
      const request = original.call(this, key);
      if (this.name === 'localFiles') this.transaction.abort();
      return request;
    };
    let rejected = false;
    try { await store.deleteProject(source.shoot.id); }
    catch { rejected = true; }
    finally { IDBObjectStore.prototype.delete = original; }
    const retained = await store.loadProject(source.shoot.id);
    const bytes = await (await store.loadLocalFileBlob('unique'))?.text();
    await store.deleteProject(source.shoot.id);
    await store.deleteProject('already-missing');
    return { rejected, retained, bytes, afterRetry: await store.loadProject(source.shoot.id), blobAfterRetry: await store.loadLocalFileBlob('unique') };
  }, project('source', ['unique']));
  expect(result.rejected).toBe(true);
  expect(result.retained?.shoot.id).toBe('source');
  expect(result.bytes).toBe('untouched original');
  expect(result.afterRetry).toBeNull();
  expect(result.blobAfterRetry).toBeNull();
});
