import assert from 'node:assert/strict';
import test from 'node:test';
import { LAST_EXPORT_FOLDER_KEY, lastExportFolder, reasonOf, rememberExportFolder } from './exportFolderChoice';

test('the folder picker starts where the last export went, and nowhere odd', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
  assert.equal(lastExportFolder(storage), undefined, 'nothing remembered: the system default');
  rememberExportFolder(storage, 'E:/Exports');
  assert.equal(values.get(LAST_EXPORT_FOLDER_KEY), 'E:/Exports');
  assert.equal(lastExportFolder(storage), 'E:/Exports');
  assert.equal(lastExportFolder({ getItem: () => { throw new Error('blocked'); } }), undefined);
  assert.equal(lastExportFolder(null), undefined);
  assert.doesNotThrow(() => rememberExportFolder({ setItem: () => { throw new Error('full'); } }, 'x'));
});

test('the real reason is shown, also when the desktop app rejects with plain text', () => {
  assert.equal(reasonOf(new Error(' forbidden path: E:/x ')), 'forbidden path: E:/x');
  assert.equal(reasonOf('forbidden path: E:/InFlight Exports'), 'forbidden path: E:/InFlight Exports');
  assert.equal(reasonOf({ message: 'disk full' }), 'disk full');
  assert.equal(reasonOf(undefined), '');
  assert.equal(reasonOf(42), '');
});
