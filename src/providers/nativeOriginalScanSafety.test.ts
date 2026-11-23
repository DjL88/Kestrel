import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { scanOriginalFolder, matchScannedOriginalsBySha } from './nativeOriginalScan';

test('malformed directory entries never escape the chosen root or reach stat', async () => {
  const visited: string[] = [];
  const entries = ['..', '.', '../outside', 'sub/../../outside', '\\outside', 'C:evil', '', 'safe.NEF'];
  const scan = await scanOriginalFolder('/photos', async () =>
    entries.map(name => ({ name, isFile: true, isDirectory: false })),
    async path => { visited.push(path); return { size: 3, mtime: new Date(100) }; },
    new Set(entries.map(name => name.toLowerCase())));
  assert.deepEqual(visited, ['/photos/safe.NEF']);
  assert.deepEqual(scan.files.map(file => file.path), ['/photos/safe.NEF']);
});

test('relink treats case and slash aliases as one path and reads candidate once', async () => {
  const bytes = new Blob([new Uint8Array([1, 2, 3])]);
  const originalSha256 = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
  const candidates = [
    { path: 'D:\\Photos\\BIRD.NEF', name: 'BIRD.NEF', size: 3, lastModified: 10 },
    { path: 'd:/photos/bird.nef', name: 'bird.nef', size: 3, lastModified: 10 },
  ];
  let reads = 0;
  const result = await matchScannedOriginalsBySha(
    [{ stableKey: 'bird', filename: 'BIRD.NEF', size: 3, originalSha256 }],
    candidates, [], async () => {
      reads++;
      return { bytes, unchanged: async () => true, close: async () => {} };
    });
  assert.equal(reads, 1);
  assert.equal(result.matches.size, 1);
  assert.deepEqual(result.ambiguous, []);
});

test('reserved path aliases cannot reconnect and do not read original bytes', async () => {
  const bytes = new Blob([new Uint8Array([1, 2, 3])]);
  const originalSha256 = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
  let reads = 0;
  const result = await matchScannedOriginalsBySha(
    [{ stableKey: 'bird', filename: 'BIRD.NEF', size: 3, originalSha256 }],
    [{ path: 'D:\\Photos\\BIRD.NEF', name: 'BIRD.NEF', size: 3, lastModified: 10 }],
    ['d:/photos/bird.nef'], async () => {
      reads++;
      return { bytes, unchanged: async () => true, close: async () => {} };
    });
  assert.equal(reads, 0);
  assert.equal(result.matches.size, 0);
  assert.deepEqual(result.rejected, ['bird']);
});
