import test from 'node:test';
import assert from 'node:assert/strict';
import { matchScannedOriginals, scanOriginalFolder } from './nativeOriginalScan';

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
