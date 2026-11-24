import assert from 'node:assert/strict';
import test from 'node:test';
import { draggedPhotoIds, readPhotoDrag } from './photoDrag.ts';

test('dragging a selected photo carries the whole selection, starting with the dragged one', () => {
  assert.deepEqual(draggedPhotoIds('b', ['a', 'b', 'c']), ['b', 'a', 'c']);
  assert.deepEqual(draggedPhotoIds('z', ['a', 'b']), ['z']);
});

test('malformed drops carry no photographs', () => {
  assert.deepEqual(readPhotoDrag(''), []);
  assert.deepEqual(readPhotoDrag('not json'), []);
  assert.deepEqual(readPhotoDrag('{"a":1}'), []);
  assert.deepEqual(readPhotoDrag('["a", 3, null, "b"]'), ['a', 'b']);
});
