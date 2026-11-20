import test from 'node:test';
import assert from 'node:assert/strict';
import { pickedKey, pickedFromFile, type PickedPhoto } from './linkedOriginals';
import { originalSourceKey } from '../core/originalSourceKey';

const linked = (path: string): PickedPhoto => ({
  name: '_DSC0001.NEF',
  size: 32_000_000,
  lastModified: 1763568000000,
  path,
  read: async () => new File([], '_DSC0001.NEF'),
});

test('desktop import and duplicate detection share one path-scoped identity', () => {
  const first = linked('D:\\Wildlife\\Z8\\_DSC0001.NEF');
  const second = linked('D:\\Wildlife\\Z5II\\_DSC0001.NEF');
  assert.equal(pickedKey(first), originalSourceKey(first));
  assert.notEqual(pickedKey(first), pickedKey(second),
    'two folders with identical filename, size and modification date must not share a preview');
  assert.equal(pickedKey(first), pickedKey(linked('d:/wildlife/z8/_DSC0001.nef')));
});

test('browser File and legacy photo catalogue keys do not change', () => {
  const file = new File(['image'], 'bird.jpg', { lastModified: 1234 });
  assert.equal(pickedKey(pickedFromFile(file)), 'local-file://bird.jpg::5::1234');
});

test('500 uniquely linked camera originals do not collapse into one catalogue entry', () => {
  const source = Array.from({ length: 500 }, (_, n) => linked(`E:/shoot-${n}/_DSC0001.NEF`));
  assert.equal(new Set(source.map(pickedKey)).size, source.length);
});
