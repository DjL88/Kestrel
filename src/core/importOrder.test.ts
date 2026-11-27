import assert from 'node:assert/strict';
import test from 'node:test';
import { inGroups, parseXmpRating, ratedFirstOrder } from './importOrder';

test('reads a star rating from an attribute or an element, and ignores everything else', () => {
  assert.equal(parseXmpRating('<rdf:Description xmp:Rating="4" />'), 4);
  assert.equal(parseXmpRating("<x xmp:Rating = '5'/>"), 5);
  assert.equal(parseXmpRating('<xmp:Rating>3</xmp:Rating>'), 3);
  assert.equal(parseXmpRating('<x xmp:Rating="0"/>'), undefined);
  assert.equal(parseXmpRating('<x xmp:Rating="-1"/>'), undefined);
  assert.equal(parseXmpRating('<x xmp:Rating="9"/>'), undefined);
  assert.equal(parseXmpRating('nothing'), undefined);
});

test('rated photos come first, best first; ties and unrated keep picked order; nothing is lost', () => {
  const order = ratedFirstOrder([undefined, 3, undefined, 5, 3, undefined, 5]);
  assert.deepEqual(order, [3, 6, 1, 4, 0, 2, 5]);
  assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ratedFirstOrder([undefined, undefined, undefined]), [0, 1, 2]);
  assert.deepEqual(ratedFirstOrder([]), []);
});

test('groups keep order and the last may be short; the size is bounded', () => {
  assert.deepEqual(inGroups([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(inGroups([1, 2, 3], 0), [[1], [2], [3]]);
  assert.deepEqual(inGroups([1, 2, 3], Number.NaN), [[1], [2], [3]]);
  assert.equal(inGroups(Array.from({ length: 200 }, (_, i) => i), 999).length, 4);
  assert.deepEqual(inGroups([], 6), []);
});
