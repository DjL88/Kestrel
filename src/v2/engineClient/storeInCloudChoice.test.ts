import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STORE_CHOICE, readStoreChoice, writeStoreChoice } from './storeInCloudChoice.ts';

const memory = () => { const map = new Map<string, string>(); return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } }; };

test('a choice survives a restart, per project', () => {
  const storage = memory();
  writeStoreChoice('p1', { ...DEFAULT_STORE_CHOICE, filter: 'tag', tag: 'Puffin', selectedIds: ['a', 'b'], originals: false }, storage);
  assert.deepEqual(readStoreChoice('p1', storage), { ...DEFAULT_STORE_CHOICE, filter: 'tag', tag: 'Puffin', selectedIds: ['a', 'b'], originals: false });
  assert.deepEqual(readStoreChoice('p2', storage), DEFAULT_STORE_CHOICE, 'another project starts from the default');
});

test('anything unreadable falls back to the default and never widens the choice', () => {
  const storage = memory();
  storage.map.set('kestrel.store-cloud.choice.v1.p1', '{not json');
  assert.deepEqual(readStoreChoice('p1', storage), DEFAULT_STORE_CHOICE);
  storage.map.set('kestrel.store-cloud.choice.v1.p1', JSON.stringify({ filter: 'everything', top: 'x', minRating: 99, selectedIds: [1, 'ok'], tag: 5 }));
  const read = readStoreChoice('p1', storage);
  assert.equal(read.filter, 'all');
  assert.equal(read.minRating, 5, 'out-of-range stars are held to five');
  assert.deepEqual(read.selectedIds, [], 'one bad id drops the whole manual list rather than keeping part of it');
  assert.equal(readStoreChoice(null, storage).filter, 'all');
  assert.doesNotThrow(() => readStoreChoice('p1', { getItem: () => { throw new Error('denied'); } }));
  assert.doesNotThrow(() => writeStoreChoice('p1', DEFAULT_STORE_CHOICE, { setItem: () => { throw new Error('full'); } }));
});
