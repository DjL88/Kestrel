import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStored, watermarkSlots } from './watermarkLibrary.ts';

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

test('guided watermark import assigns the requested photo backgrounds without recolouring', () => {
  assert.deepEqual(watermarkSlots(id, 'dark', 0.1), { forDark: id });
  assert.deepEqual(watermarkSlots(id, 'light', 0.9), { forLight: id });
  assert.deepEqual(watermarkSlots(id, 'both', 0.9), { forDark: id, forLight: id });
  assert.deepEqual(watermarkSlots(id, 'auto', 0.1), { forLight: id });
  assert.deepEqual(watermarkSlots(id, 'auto', 0.9), { forDark: id });
});

test('duplicate watermark IDs cannot resolve to different artwork after reopening', () => {
  const list = parseStored(JSON.stringify([
    { id: 'mark', label: 'Original', forDark: id },
    { id: 'mark', label: 'Duplicate', forLight: 'b'.repeat(64) },
    { id: ' ', label: 'Invalid', forDark: id },
    { id: 'other', label: 'Other', forLight: id },
  ]));
  assert.deepEqual(list.map(entry => entry.label), ['Original', 'Other']);
  assert.equal(list[0].forDark, id);
});
