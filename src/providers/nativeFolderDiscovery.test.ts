import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverPhotoPaths } from './nativeFolderDiscovery';

test('discovers mixed-camera RAW and JPEG files in nested shoot folders', async () => {
  const folders: Record<string, { name: string; isFile: boolean; isDirectory: boolean }[]> = {
    '/shoot': [{ name: 'DCIM', isFile: false, isDirectory: true }, { name: 'notes.txt', isFile: true, isDirectory: false }],
    '/shoot/DCIM': [{ name: '100NIKON', isFile: false, isDirectory: true }, { name: '100CANON', isFile: false, isDirectory: true }],
    '/shoot/DCIM/100NIKON': [{ name: 'Z8.NEF', isFile: true, isDirectory: false }],
    '/shoot/DCIM/100CANON': [{ name: 'R5.CR3', isFile: true, isDirectory: false }, { name: 'JPEG.JPG', isFile: true, isDirectory: false }],
  };
  const result = await discoverPhotoPaths('/shoot', async path => folders[path] ?? [], new Set(['nef', 'cr3', 'jpg']));
  assert.deepEqual(result.paths, ['/shoot/DCIM/100NIKON/Z8.NEF', '/shoot/DCIM/100CANON/R5.CR3', '/shoot/DCIM/100CANON/JPEG.JPG']);
  assert.equal(result.truncated, false);
});
test('does not follow symlinks or scan unbounded directory trees', async () => {
  let reads = 0;
  const result = await discoverPhotoPaths('/photos', async () => {
    reads++;
    return [
      { name: 'loop', isFile: false, isDirectory: true, isSymlink: true },
      { name: 'more', isFile: false, isDirectory: true },
      { name: 'IMG.ARW', isFile: true, isDirectory: false },
    ];
  }, new Set(['arw']), { maxEntries: 2 });
  assert.equal(reads, 1);
  assert.equal(result.truncated, true);
});
test('unreadable subfolder is reported instead of silently skipped', async () => {
  const result = await discoverPhotoPaths('/photos', async path => {
    if (path !== '/photos') throw Error('network disconnected');
    return [{ name: 'sub', isFile: false, isDirectory: true }];
  }, new Set(['raf']));
  assert.equal(result.skippedFolders, 1);
});
