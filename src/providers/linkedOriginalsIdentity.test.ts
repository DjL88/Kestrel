import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkedSourceMatches } from './linkedOriginals';

test('linked source accepts the same size', () => {
  assert.equal(linkedSourceMatches(1024, 1024), true);
});
test('a different photo at the same path is refused by its size', () => {
  assert.equal(linkedSourceMatches(1024, 2048), false);
});
test('a reconnected copy with a new modified time but the same size still opens', () => {
  // Reconnect matches by name and size when the modified time changed; the reader must agree with it.
  assert.equal(linkedSourceMatches(1024, 1024), true);
});
test('callers that do not know the size are not blocked', () => {
  assert.equal(linkedSourceMatches(undefined, 1024), true);
});
test('invalid sizes never match', () => {
  assert.equal(linkedSourceMatches(-1, 1024), false);
  assert.equal(linkedSourceMatches(0, 0), false);
  assert.equal(linkedSourceMatches(undefined, Number.NaN), false);
  assert.equal(linkedSourceMatches(1024, -1), false);
});
