import test from 'node:test';
import assert from 'node:assert/strict';
import { moveArtboard, readBoard } from './boardOps.ts';

test('positions are kept, rounded and clamped; junk is ignored', () => {
  assert.deepEqual(readBoard({ a: { x: 10.4, y: -20.6 }, b: { x: 'no', y: 1 }, c: null, d: { x: 99999, y: -99999 } }), { a: { x: 10, y: -21 }, d: { x: 4000, y: -4000 } });
  assert.deepEqual(readBoard(undefined), {});
  assert.deepEqual(readBoard([1, 2]), {});
});

test('moving one artboard leaves the others, and a bad move changes nothing', () => {
  const start = { a: { x: 1, y: 2 } };
  assert.deepEqual(moveArtboard(start, 'b', 30, 40), { a: { x: 1, y: 2 }, b: { x: 30, y: 40 } });
  assert.deepEqual(moveArtboard(start, 'a', Number.NaN, 5), start);
});
