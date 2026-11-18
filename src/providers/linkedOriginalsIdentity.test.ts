import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkedSourceMatches } from './linkedOriginals';

test('linked source accepts identical size and timestamp', () => {
  assert.equal(linkedSourceMatches(1024, 1700000000000, 1024, 1700000000000), true);
});
test('linked source rejects changed file even at same path', () => {
  assert.equal(linkedSourceMatches(1024, 1700000000000, 2048, 1700000000000), false);
  assert.equal(linkedSourceMatches(1024, 1700000000000, 1024, 1700000005000), false);
});
test('legacy callers without expected size still detect timestamp changes', () => {
  assert.equal(linkedSourceMatches(undefined, 1700000000000, 1024, 1700000005000), false);
});
test('invalid sizes never match', () => {
  assert.equal(linkedSourceMatches(-1, 0, 1024), false);
  assert.equal(linkedSourceMatches(undefined, 0, NaN), false);
});
