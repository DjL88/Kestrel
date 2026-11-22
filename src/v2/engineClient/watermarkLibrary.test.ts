import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStored } from './watermarkLibrary.ts';

const id = 'a'.repeat(64);

test('a stored library is read defensively', () => {
  assert.deepEqual(parseStored(null), []);
  assert.deepEqual(parseStored('nope'), []);
  assert.deepEqual(parseStored('{"a":1}'), []);
  const list = parseStored(JSON.stringify([
    { id: 'w1', label: 'My logo', forDark: id, forLight: 'not-a-hash' },
    { id: 5, label: 'bad' }, { label: 'no id' }, 'junk',
    { id: 'w2', label: 'x'.repeat(200), forLight: id },
  ]));
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { id: 'w1', label: 'My logo', forDark: id, forLight: undefined });
  assert.equal(list[1].label.length, 60);
  assert.equal(list[1].forLight, id);
});
