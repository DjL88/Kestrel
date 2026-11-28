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


test('a project switch during directory scan stops further stat calls and discards partial results', async () => {
  let live = true;
  const visited: string[] = [];
  const result = await scanOriginalFolder('/photos',
    async () => ['A.NEF', 'B.NEF', 'C.NEF'].map(name => ({ name, isFile: true, isDirectory: false })),
    async path => {
      visited.push(path);
      if (visited.length === 2) live = false;
      return { size: 3 };
    }, new Set(['a.nef', 'b.nef', 'c.nef']), { stillCurrent: () => live });
  assert.deepEqual(visited, ['/photos/A.NEF', '/photos/B.NEF']);
  assert.deepEqual(result.files, []);
});

test('a project switch mid-fingerprint closes the source, reads no further ranges and returns no partial matches', async () => {
  let live = true;
  let opened = 0, closed = 0, ranges = 0;
  const small = new Blob(['abc']);
  const large = new Blob([new Uint8Array(3 * 1024 * 1024)]);
  const digest = createHash('sha256').update('abc').digest('hex');
  const largeDigest = createHash('sha256').update(new Uint8Array(await large.arrayBuffer())).digest('hex');
  const candidates = [
    { path: '/a.NEF', name: 'a.NEF', size: small.size, lastModified: 1 },
    { path: '/b.NEF', name: 'b.NEF', size: large.size, lastModified: 1 },
    { path: '/c.NEF', name: 'c.NEF', size: small.size, lastModified: 1 },
  ];
  const result = await matchScannedOriginalsBySha(candidates.map((c, i) => ({
    stableKey: c.path, filename: c.name, size: c.size, originalSha256: i === 1 ? largeDigest : digest,
  })), candidates, [], async path => {
    opened++;
    const source = path === '/b.NEF' ? large : small;
    return {
      bytes: { size: source.size, slice(start, end) { return { async arrayBuffer() {
        ranges++;
        if (source === large) live = false;
        return source.slice(start, end).arrayBuffer();
      } }; } },
      unchanged: async () => true,
      close: async () => { closed++; },
    };
  }, () => live);
  assert.equal(opened, 2);
  assert.equal(closed, 2);
  assert.equal(ranges, 2, 'first small file and one range of the cancelled RAW');
  assert.equal(result.matches.size, 0);
  assert.deepEqual(result.ambiguous, []);
  assert.deepEqual(result.rejected, []);
});
