import assert from 'node:assert/strict';
import test from 'node:test';
import { addCropDismissal, readCropDismissals } from './cropDismissals';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };

test('a hidden crop idea is remembered for that photo and format only', () => {
  const store = memory();
  const keys = addCropDismissal(store, readCropDismissals(store), 'p1:original');
  assert.deepEqual(readCropDismissals(store), ['p1:original']);
  assert.deepEqual(addCropDismissal(store, keys, 'p1:original'), ['p1:original']);
  assert.ok(!readCropDismissals(store).includes('p2:original'));
});

test('missing, broken or blocked storage never throws', () => {
  assert.deepEqual(readCropDismissals(null), []);
  assert.deepEqual(readCropDismissals({ getItem: () => '{oops', setItem: () => {} }), []);
  const blocked = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
  assert.deepEqual(readCropDismissals(blocked), []);
  assert.deepEqual(addCropDismissal(blocked, [], 'a:b'), ['a:b']);
});
