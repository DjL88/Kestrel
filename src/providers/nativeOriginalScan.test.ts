import test from 'node:test';
import assert from 'node:assert/strict';
import { matchScannedOriginals, matchScannedOriginalsBySha, scanOriginalFolder, verifyScannedOriginalMatches, resolveNativeOriginalRelinks } from './nativeOriginalScan';
import { createHash } from 'node:crypto';

test('nested camera folders recover mixed camera brands without reading photo bytes', async () => {
  const folders: Record<string, { name: string; isFile: boolean; isDirectory: boolean }[]> = {
    'D:/photos': [{ name: 'Canon', isFile: false, isDirectory: true }, { name: 'Sony', isFile: false, isDirectory: true }],
    'D:/photos/Canon': [{ name: 'IMG.CR3', isFile: true, isDirectory: false }],
    'D:/photos/Sony': [{ name: 'DSC.ARW', isFile: true, isDirectory: false }],
  };
  let stats = 0;
  const scan = await scanOriginalFolder('D:/photos', async path => folders[path] ?? [], async () => {
    stats++; return { size: 123, mtime: new Date(1000) };
  }, new Set(['img.cr3', 'dsc.arw']));
  assert.equal(stats, 2);
  assert.equal(scan.files.length, 2);
  assert.equal(scan.truncated, false);
});
test('duplicate filenames and metadata are ambiguous, not guessed', () => {
  const expected = [{ stableKey: 'a', filename: 'DSC001.NEF', size: 100, lastModified: 10 }];
  const files = ['D:/a/DSC001.NEF', 'D:/b/DSC001.NEF'].map(path =>
    ({ path, name: 'DSC001.NEF', size: 100, lastModified: 10 }));
  const result = matchScannedOriginals(expected, files);
  assert.equal(result.matches.size, 0);
  assert.deepEqual(result.ambiguous, ['a']);
});
test('bounded scan does not follow symlinks or descend indefinitely', async () => {
  const scan = await scanOriginalFolder('/photos', async () => [
    { name: 'loop', isFile: false, isDirectory: true, isSymlink: true },
    { name: 'subfolder', isFile: false, isDirectory: true },
    { name: 'IMG.JPG', isFile: true, isDirectory: false },
  ], async () => ({ size: 1 }), new Set(['img.jpg']), { maxEntries: 2 });
  assert.equal(scan.truncated, true);
  assert.equal(scan.files.length, 0);
});

test('two unrelated catalogue keys cannot claim one scanned file', () => {
  const expected = ['key-a', 'key-b'].map(stableKey =>
    ({ stableKey, filename: 'IMG_0001.CR3', size: 100, lastModified: 50 }));
  const result = matchScannedOriginals(expected,
    [{ path: '/shoot/IMG_0001.CR3', name: 'IMG_0001.CR3', size: 100, lastModified: 50 }]);
  assert.equal(result.matches.size, 0);
  assert.deepEqual(result.ambiguous, ['key-a', 'key-b']);
});

test('a file with the same name and size is left unresolved if the timestamp differs', () => {
  const expected = [{ stableKey: 'a', filename: 'DSC001.NEF', size: 100, lastModified: 10 }];
  const result = matchScannedOriginals(expected, [{ path: 'D:/new/dsc001.nef', name: 'dsc001.nef', size: 100, lastModified: 99 }]);
  assert.equal(result.matches.size, 0);
});

test('name and size alone never guess between two candidates, or two missing photos', () => {
  const one = [{ stableKey: 'a', filename: 'IMG.NEF', size: 100, lastModified: 10 }];
  const two = ['D:/x/IMG.NEF', 'D:/y/IMG.NEF'].map(path => ({ path, name: 'IMG.NEF', size: 100, lastModified: 99 }));
  assert.equal(matchScannedOriginals(one, two).matches.size, 0);
  const missing = ['a', 'b'].map(stableKey => ({ stableKey, filename: 'IMG.NEF', size: 100, lastModified: stableKey === 'a' ? 10 : 11 }));
  assert.equal(matchScannedOriginals(missing, [two[0]]).matches.size, 0);
});

test('a missing original with matching size and timestamp can reconnect', () => {
  const expected = [{ stableKey: 'a', filename: 'IMG.NEF', size: 100, lastModified: 10 }];
  const result = matchScannedOriginals(expected, [{ path: 'D:/IMG.NEF', name: 'IMG.NEF', size: 100, lastModified: 10 }]);
  assert.equal(result.matches.get('a'), 'D:/IMG.NEF');
});

test('a connected original cannot also be assigned to a missing photo', () => {
  const expected = [{ stableKey: 'a', filename: 'IMG.NEF', size: 100, lastModified: 10 }];
  const candidate = { path: 'D:/photos/IMG.NEF', name: 'IMG.NEF', size: 100, lastModified: 10 };
  const result = matchScannedOriginals(expected, [candidate], ['d:\\Photos\\IMG.NEF']);
  assert.equal(result.matches.size, 0);
  assert.deepEqual(result.ambiguous, ['a']);
});


test('desktop reselect refuses an equal-name, equal-size, equal-mtime replacement with wrong bytes', async () => {
  const original = new Blob([new Uint8Array([1, 2, 3, 4])]);
  const replacement = new Blob([new Uint8Array([1, 2, 3, 5])]);
  const sha = createHash('sha256').update(new Uint8Array(await original.arrayBuffer())).digest('hex');
  const metadata = [{ stableKey: 'file-a', filename: 'A.NEF', size: 4, lastModified: 123 }];
  const candidates = [{ path: '/nas/A.NEF', name: 'A.NEF', size: 4, lastModified: 123 }];
  const proposed = matchScannedOriginals(metadata, candidates).matches;
  assert.equal(proposed.size, 1, 'metadata initially suggests one match');
  let closed = 0;
  const read = async () => ({ bytes: replacement, unchanged: async () => true, close: async () => { closed++; } });
  const verified = await verifyScannedOriginalMatches(proposed, [{ stableKey: 'file-a', originalSha256: sha }], read);
  assert.equal(verified.matches.size, 0);
  assert.deepEqual(verified.rejected, ['file-a']);
  assert.equal(closed, 1);
});

test('desktop relink accepts identical bytes and closes the range', async () => {
  const bytes = new Blob([new Uint8Array([8, 7, 6, 5])]);
  const sha = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
  let closed = false;
  const result = await verifyScannedOriginalMatches(new Map([['a', '/restored/A.NEF']]),
    [{ stableKey: 'a', originalSha256: sha }], async () => ({
      bytes, unchanged: async () => true, close: async () => { closed = true; },
    }));
  assert.equal(result.matches.get('a'), '/restored/A.NEF');
  assert.deepEqual(result.rejected, []);
  assert.equal(closed, true);
});

test('missing fingerprints, disconnected drives, and files changed during hashing cannot reconnect', async () => {
  const candidate = new Map([['legacy', '/nas/legacy.NEF'], ['changed', '/nas/changed.NEF'], ['offline', '/nas/offline.NEF']]);
  const bytes = new Blob([new Uint8Array([1, 2, 3])]);
  const sha = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
  const opened: string[] = [], closed: string[] = [];
  const result = await verifyScannedOriginalMatches(candidate,
    [{ stableKey: 'legacy' }, { stableKey: 'changed', originalSha256: sha }, { stableKey: 'offline', originalSha256: sha }],
    async path => {
      opened.push(path);
      if (path.includes('offline')) throw new Error('NAS disconnected');
      return { bytes, unchanged: async () => false, close: async () => { closed.push(path); } };
    });
  assert.equal(result.matches.size, 0);
  assert.deepEqual(result.rejected, ['legacy', 'changed', 'offline']);
  assert.deepEqual(opened, ['/nas/changed.NEF', '/nas/offline.NEF']);
  assert.deepEqual(closed, ['/nas/changed.NEF']);
});


test('a restored original with changed mtime reconnects when complete bytes match', async () => {
  const bytes = new Blob([new Uint8Array([7, 8, 9, 10])]);
  const sha = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
  const expected = [{ stableKey: 'a', filename: 'BIRD.NEF', size: 4, originalSha256: sha }];
  const files = [{ path: '/backup/BIRD.NEF', name: 'BIRD.NEF', size: 4, lastModified: 98765 }];
  const result = await matchScannedOriginalsBySha(expected, files, [], async () => ({
    bytes, unchanged: async () => true, close: async () => {},
  }));
  assert.equal(result.matches.get('a'), '/backup/BIRD.NEF');
  assert.deepEqual(result.ambiguous, []);
});

test('when two backups contain identical original bytes, do not silently choose one', async () => {
  const bytes = new Blob([new Uint8Array([1, 2, 3])]);
  const sha = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
  const frames = [{ stableKey: 'a', filename: 'BIRD.NEF', size: 3, originalSha256: sha }];
  const files = [1, 2].map(n => ({ path: `/restore${n}/BIRD.NEF`, name: 'BIRD.NEF', size: 3, lastModified: n }));
  const result = await matchScannedOriginalsBySha(frames, files, [], async () => ({
    bytes, unchanged: async () => true, close: async () => {},
  }));
  assert.equal(result.matches.size, 0);
  assert.deepEqual(result.ambiguous, ['a']);
});

test('two different catalogue identities cannot silently claim the same matching physical original', async () => {
  const bytes = new Blob([new Uint8Array([1, 2, 3])]);
  const sha = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
  const frames = ['a', 'b'].map(stableKey => ({ stableKey, filename: 'BIRD.NEF', size: 3, originalSha256: sha }));
  const files = [{ path: '/backup/BIRD.NEF', name: 'BIRD.NEF', size: 3, lastModified: 1 }];
  let reads = 0;
  const result = await matchScannedOriginalsBySha(frames, files, [], async () => {
    reads++;
    return { bytes, unchanged: async () => true, close: async () => {} };
  });
  assert.equal(result.matches.size, 0);
  assert.deepEqual(result.ambiguous, ['a', 'b']);
  assert.equal(reads, 1, 'read large candidate NEF once, then reuse checked digest');
});

test('same-size substituted bytes, missing SHA and connected/reserved paths cannot reconnect', async () => {
  const original = new Uint8Array([1, 2, 3]);
  const replacement = new Blob([new Uint8Array([1, 2, 4])]);
  const sha = createHash('sha256').update(original).digest('hex');
  const frames = [{ stableKey: 'bad', filename: 'A.NEF', size: 3, originalSha256: sha },
    { stableKey: 'legacy', filename: 'B.NEF', size: 3 },
    { stableKey: 'reserved', filename: 'C.NEF', size: 3, originalSha256: sha }];
  const files = ['A', 'B', 'C'].map(n => ({ path: `/nas/${n}.NEF`, name: `${n}.NEF`, size: 3, lastModified: 10 }));
  const result = await matchScannedOriginalsBySha(frames, files, ['/nas/C.NEF'], async () => ({
    bytes: replacement, unchanged: async () => true, close: async () => {},
  }));
  assert.equal(result.matches.size, 0);
  assert.deepEqual(result.rejected, ['bad', 'legacy', 'reserved']);
});

test('conflicting fingerprints for one stable key never reach the file reader', async () => {
  const bytes = new Blob([new Uint8Array([1, 2, 3])]);
  const sha = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
  let reads = 0;
  const result = await verifyScannedOriginalMatches(
    new Map([['same', '/backup/BIRD.NEF']]),
    [{ stableKey: 'same', originalSha256: sha }, { stableKey: 'same', originalSha256: 'f'.repeat(64) }],
    async () => { reads++; return { bytes, unchanged: async () => true, close: async () => {} }; },
  );
  assert.equal(reads, 0);
  assert.equal(result.matches.size, 0);
  assert.deepEqual(result.rejected, ['same']);
});

test('two catalogue identities cannot claim one path even with valid identical bytes', async () => {
  const bytes = new Blob([new Uint8Array([1, 2, 3])]);
  const sha = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
  let reads = 0;
  const result = await verifyScannedOriginalMatches(
    new Map([['first', '/NAS/BIRD.NEF'], ['second', '/nas/BIRD.NEF']]),
    [{ stableKey: 'first', originalSha256: sha }, { stableKey: 'second', originalSha256: sha }],
    async () => { reads++; return { bytes, unchanged: async () => true, close: async () => {} }; },
  );
  assert.equal(reads, 0);
  assert.equal(result.matches.size, 0);
  assert.deepEqual(result.rejected, ['first', 'second']);
});

test('unique verified original remains eligible and closes the reader', async () => {
  const bytes = new Blob([new Uint8Array([1, 2, 3])]);
  const sha = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
  let closes = 0;
  const result = await verifyScannedOriginalMatches(
    new Map([['unique', '/backup/BIRD.NEF']]),
    [{ stableKey: 'unique', originalSha256: sha }],
    async () => ({ bytes, unchanged: async () => true, close: async () => { closes++; } }),
  );
  assert.equal(result.matches.get('unique'), '/backup/BIRD.NEF');
  assert.deepEqual(result.rejected, []);
  assert.equal(closes, 1);
});


test('explicit desktop reconnect verifies current paths and recovers an overwritten original from backup', async () => {
  const genuine = new Blob([new Uint8Array([1, 2, 3])]);
  const substituted = new Blob([new Uint8Array([1, 2, 4])]);
  const sha = createHash('sha256').update(new Uint8Array(await genuine.arrayBuffer())).digest('hex');
  const expected = [
    { stableKey: 'substituted', filename: 'BIRD.NEF', sourcePath: '/card/BIRD.NEF', size: 3, originalSha256: sha },
    { stableKey: 'healthy', filename: 'DOG.NEF', sourcePath: '/card/DOG.NEF', size: 3, originalSha256: sha },
    { stableKey: 'legacy', filename: 'OLD.NEF', sourcePath: '/card/OLD.NEF', size: 3 },
  ];
  const opened: string[] = [], closed: string[] = [];
  const read = async (path: string, bytes: Blob) => {
    opened.push(path);
    return { bytes, unchanged: async () => true, close: async () => { closed.push(path); } };
  };
  const result = await resolveNativeOriginalRelinks(expected, new Set(expected.map(frame => frame.sourcePath)),
    async names => {
      assert.deepEqual([...names].sort(), ['bird.nef', 'old.nef']);
      return { files: [{ path: '/backup/BIRD.NEF', name: 'BIRD.NEF', size: 3, lastModified: 10 }], truncated: false, skippedDirectories: 0 };
    },
    path => read(path, path.endsWith('BIRD.NEF') ? substituted : genuine),
    candidate => read(candidate.path, genuine));
  assert.deepEqual([...result.connected], [['healthy', '/card/DOG.NEF']]);
  assert.deepEqual(result.missing, ['substituted', 'legacy']);
  assert.deepEqual([...result.matches], [['substituted', '/backup/BIRD.NEF']]);
  assert.deepEqual(opened, ['/card/BIRD.NEF', '/card/DOG.NEF', '/backup/BIRD.NEF']);
  assert.deepEqual(closed, opened);
  assert.equal(expected[0].sourcePath, '/card/BIRD.NEF', 'planning never mutates the catalogue');
});

test('healthy existing paths avoid scanning the selected backup folder', async () => {
  const bytes = new Blob([new Uint8Array([5, 6, 7])]);
  const sha = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
  const result = await resolveNativeOriginalRelinks(
    [{ stableKey: 'good', filename: 'A.NEF', sourcePath: '/nas/A.NEF', size: 3, originalSha256: sha }],
    new Set(['/nas/A.NEF']),
    async () => { throw new Error('should not scan'); },
    async () => ({ bytes, unchanged: async () => true, close: async () => {} }),
    async () => { throw new Error('should not open candidate'); });
  assert.deepEqual([...result.connected], [['good', '/nas/A.NEF']]);
  assert.deepEqual(result.missing, []);
  assert.equal(result.matches.size, 0);
});


test('case-sensitive NAS paths are hashed separately before selecting a replacement', async () => {
  const genuine = new Blob([new Uint8Array([1, 2, 3])]);
  const wrong = new Blob([new Uint8Array([1, 2, 4])]);
  const sha = createHash('sha256').update(new Uint8Array(await genuine.arrayBuffer())).digest('hex');
  const files = ['/NAS/BIRD.NEF', '/nas/BIRD.NEF'].map(path => ({ path, name: 'BIRD.NEF', size: 3, lastModified: 1 }));
  const readPaths: string[] = [];
  const result = await matchScannedOriginalsBySha(
    [{ stableKey: 'bird', filename: 'BIRD.NEF', size: 3, originalSha256: sha }], files, [],
    async path => {
      readPaths.push(path);
      return { bytes: path === files[0].path ? genuine : wrong, unchanged: async () => true, close: async () => {} };
    });
  assert.deepEqual(readPaths, files.map(file => file.path));
  assert.equal(result.matches.get('bird'), files[0].path);
  const identical = await matchScannedOriginalsBySha(
    [{ stableKey: 'bird', filename: 'BIRD.NEF', size: 3, originalSha256: sha }], files, [],
    async () => ({ bytes: genuine, unchanged: async () => true, close: async () => {} }));
  assert.equal(identical.matches.size, 0);
  assert.deepEqual(identical.ambiguous, ['bird']);
});

test('backup search refuses conflicting fingerprints for the same catalogue identity', async () => {
  const bytes = new Blob([new Uint8Array([1, 2, 3])]);
  const sha = createHash('sha256').update(new Uint8Array(await bytes.arrayBuffer())).digest('hex');
  const frame = { stableKey: 'same', filename: 'BIRD.NEF', size: 3, originalSha256: sha };
  let reads = 0;
  const result = await matchScannedOriginalsBySha([frame, { ...frame, originalSha256: 'f'.repeat(64) }],
    [{ path: '/backup/BIRD.NEF', name: 'BIRD.NEF', size: 3, lastModified: 1 }], [],
    async () => { reads++; return { bytes, unchanged: async () => true, close: async () => {} }; });
  assert.equal(reads, 0);
  assert.equal(result.matches.size, 0);
  assert.deepEqual(result.rejected, ['same']);
});
