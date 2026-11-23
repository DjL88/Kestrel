import assert from 'node:assert/strict';
import test from 'node:test';
import { burstBest, planFilmstrip } from './burstGroups.ts';
import type { Photo } from '../ui/contract.ts';

const photo = (id: string, burst?: Photo['burst']) => ({ id, burst } as unknown as Photo);
const b = (groupId: string, index: number, over: Partial<NonNullable<Photo['burst']>> = {}) => ({ groupId, index, count: 3, ungrouped: false, ...over });
const ids = (items: ReturnType<typeof planFilmstrip>) => items.map((item) => (item.type === 'photo' ? item.photo.id : `controls:${item.groupId}`));

test('a burst of three folds into one stack at the first frame, and single photos stay', () => {
  const list = [photo('a'), photo('x1', b('g', 0)), photo('x2', b('g', 1)), photo('x3', b('g', 2)), photo('z')];
  const items = planFilmstrip(list, new Set());
  assert.deepEqual(ids(items), ['a', 'x1', 'z']);
  const stack = items[1];
  assert.ok(stack.type === 'photo' && stack.stack?.count === 3 && stack.stack.expanded === false);
});

test('the cover is the best measured frame; with no scores it is the first, and no best is invented', () => {
  const scored = [photo('x1', b('g', 0, { score: 40 })), photo('x2', b('g', 1, { score: 90 })), photo('x3', b('g', 2))];
  assert.equal(burstBest(scored)?.id, 'x2');
  assert.deepEqual(ids(planFilmstrip(scored, new Set())), ['x2']);
  const unscored = [photo('x1', b('g', 0)), photo('x2', b('g', 1))];
  assert.equal(burstBest(unscored), null);
  assert.deepEqual(ids(planFilmstrip(unscored, new Set())), ['x1']);
});

test('expanded shows controls then every frame in capture order', () => {
  const list = [photo('x3', b('g', 2)), photo('x1', b('g', 0)), photo('x2', b('g', 1))];
  assert.deepEqual(ids(planFilmstrip(list, new Set(['g']))), ['controls:g', 'x1', 'x2', 'x3']);
});

test('a hidden active photo opens its stack; an active cover does not', () => {
  const list = [photo('x1', b('g', 0)), photo('x2', b('g', 1))];
  assert.deepEqual(ids(planFilmstrip(list, new Set(), new Set(['x2']))), ['controls:g', 'x1', 'x2']);
  assert.deepEqual(ids(planFilmstrip(list, new Set(), new Set(['x1']))), ['x1']);
});

test('a split burst shows every photo on its own, and a group of one is not a stack', () => {
  const split = [photo('x1', b('g', 0, { ungrouped: true })), photo('x2', b('g', 1, { ungrouped: true }))];
  assert.deepEqual(ids(planFilmstrip(split, new Set())), ['x1', 'x2']);
  assert.deepEqual(ids(planFilmstrip([photo('only', b('h', 0))], new Set())), ['only']);
});
