import assert from 'node:assert/strict';
import test from 'node:test';
import { addFormat, applyFormats, newCustomId, ratioLabelFor, readFormats, removeFormat, toggleFormat } from './formatOps.ts';
import { createDefaultSizes } from '../ui/stub.ts';

test('a photo with no stored formats has the built-in list unchanged', () => {
  const defaults = createDefaultSizes();
  assert.deepEqual(applyFormats(defaults, undefined).map((size) => size.id), defaults.map((size) => size.id));
  assert.deepEqual(readFormats('x'), { disabled: [], custom: [] });
});

test('switching a built-in off and on is reversible, and only that photo changes', () => {
  const off = toggleFormat(undefined, 'ig-portrait');
  assert.equal(applyFormats(createDefaultSizes(), off).find((size) => size.id === 'ig-portrait')?.enabled, false);
  const on = toggleFormat(off, 'ig-portrait');
  assert.equal(applyFormats(createDefaultSizes(), on).find((size) => size.id === 'ig-portrait')?.enabled, true);
});

test('a custom format is added with a plain ratio, switched off, and removed for good', () => {
  const id = newCustomId('a1b2c3');
  const added = addFormat(undefined, '  Poster  ', 2400, 3000, id)!;
  const sizes = applyFormats(createDefaultSizes(), added);
  const poster = sizes.find((size) => size.id === id)!;
  assert.equal(poster.label, 'Poster');
  assert.equal(poster.ratioLabel, '4:5');
  assert.equal(poster.platform, 'custom');
  assert.equal(removeFormat(added, id).custom.length, 0);
});

test('deleting a built-in switches it off instead of losing it', () => {
  const removed = removeFormat(undefined, 'yt-wide');
  assert.deepEqual(removed.disabled, ['yt-wide']);
  assert.equal(removed.custom.length, 0);
});

test('bad sizes and bad stored values are refused or dropped, never trusted', () => {
  assert.equal(addFormat(undefined, 'x', 0, 100, 'custom-abc'), undefined);
  assert.equal(addFormat(undefined, 'x', 100.5, 100, 'custom-abc'), undefined);
  assert.equal(addFormat(undefined, 'x', 99999, 100, 'custom-abc'), undefined);
  assert.equal(addFormat(undefined, 'x', 100, 100, 'not a safe id'), undefined);
  const damaged = readFormats({ disabled: [1, 'a', 'a'], custom: [{ id: 'custom-ok1', width: 10, height: 20 }, { id: '../evil', width: 10, height: 10 }, { id: 'custom-bad', width: -1, height: 5 }, 7] });
  assert.deepEqual(damaged.disabled, ['a']);
  assert.deepEqual(damaged.custom.map((c) => c.id), ['custom-ok1']);
  assert.equal(ratioLabelFor(1080, 1350), '4:5');
  assert.equal(ratioLabelFor(1234, 777), '1234×777');
});
