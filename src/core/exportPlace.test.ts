import assert from 'node:assert/strict';
import test from 'node:test';
import { exportPaths, exportRunFolder, safeExportName } from './exportPlace.ts';
import { isWritablePath } from './storageConnectors.ts';

const when = new Date(2026, 10, 16, 14, 5);

test('each save goes into its own dated export folder', () => {
  assert.equal(exportRunFolder(when), 'export/2026-11-16 14-05');
});

test('file names cannot escape the folder or be empty', () => {
  assert.equal(safeExportName('kite_4x5.jpg'), 'kite_4x5.jpg');
  assert.equal(safeExportName('../../etc/passwd'), '..-..-etc-passwd'.replace(/^\.+/, ''));
  assert.equal(safeExportName('a/b\\c:d.jpg'), 'a-b-c-d.jpg');
  assert.equal(safeExportName('...'), 'export.jpg');
  assert.equal(safeExportName(''), 'export.jpg');
  assert.equal(safeExportName('.hidden.jpg'), 'hidden.jpg');
});

test('two files with the same name in one save never replace each other', () => {
  const paths = exportPaths([{ name: 'kite.jpg' }, { name: 'Kite.JPG' }, { name: 'kite.jpg' }, { name: 'other.jpg' }], when);
  assert.deepEqual(paths, [
    'export/2026-11-16 14-05/kite.jpg', 'export/2026-11-16 14-05/Kite-2.JPG', 'export/2026-11-16 14-05/kite-3.jpg', 'export/2026-11-16 14-05/other.jpg',
  ]);
  assert.equal(new Set(paths.map((p) => p.toLowerCase())).size, paths.length);
});

test('every path it makes is one a connector is allowed to write', () => {
  for (const name of ['kite.jpg', '../x.jpg', 'a/b.jpg', '...', 'ü ñ.jpg']) for (const path of exportPaths([{ name }], when)) assert.equal(isWritablePath(path), true, path);
});

test('separate export runs in the same minute never share destination paths', () => {
  const first = exportPaths([{ name: 'Z8.NEF.jpg' }], when, '00000000-0000-4000-8000-000000000001');
  const second = exportPaths([{ name: 'Z8.NEF.jpg' }], when, '00000000-0000-4000-8000-000000000002');
  assert.notEqual(first[0], second[0]);
  assert.match(first[0], /^export\/2026-11-16 14-05-00000000/);
  assert.equal(isWritablePath(first[0]), true);
  assert.equal(isWritablePath(second[0]), true);
});
