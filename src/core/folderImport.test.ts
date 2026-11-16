import assert from 'node:assert/strict';
import test from 'node:test';
import { loadDirectoryHandleShoot } from '../providers/localShootLoader';
import type { BrowserCatalogueStore } from '../providers/browserCatalogueStore';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';

test('folder import keeps a read-only handle instead of copying original RAW files', async () => {
  const raw = new File([new Uint8Array(64)], 'DSC_0001.NEF', {
    lastModified: 1_700_000_000_000,
  });
  const fileHandle = { kind: 'file', name: raw.name, getFile: async () => raw };
  const directory = {
    kind: 'directory',
    name: 'Mach Loop',
    async *entries() { yield [raw.name, fileHandle]; },
  } as unknown as FileSystemDirectoryHandle;

  const registered: string[] = [];
  const preview = {
    registerBlob: (key: string) => { registered.push(key); },
  } as unknown as BrowserPreviewProvider;
  const savedHandles: string[] = [];
  const store = {
    saveDirectoryHandle: async (key: string) => { savedHandles.push(key); },
    saveLocalFileBlob: async () => { throw new Error('folder import must not copy originals'); },
  } as unknown as BrowserCatalogueStore;

  const { frames } = await loadDirectoryHandleShoot(
    directory,
    preview,
    store,
    undefined,
    { handleKey: 'project-mach-loop' },
  );

  assert.deepEqual(savedHandles, ['project-mach-loop']);
  assert.deepEqual(registered, ['folder://Mach Loop/DSC_0001.NEF']);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].sourceKind, 'directory-handle');
  assert.equal(frames[0].stableKey, 'folder://Mach Loop/DSC_0001.NEF');
});
