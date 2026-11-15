import assert from 'node:assert/strict';
import test from 'node:test';
import { lookAgain, startWatching, type Listing } from './folderWatch.ts';

const file = (name: string, size: number, modified = 1): Listing => ({ name, size, modified });

test('a new photo is handed over only once it has stopped growing', () => {
  const state = startWatching([], true);
  assert.deepEqual(lookAgain(state, [file('A.NEF', 1_000)]), []);
  assert.deepEqual(lookAgain(state, [file('A.NEF', 5_000)]), []);
  assert.deepEqual(lookAgain(state, [file('A.NEF', 5_000)]).map((f) => f.name), ['A.NEF']);
  assert.deepEqual(lookAgain(state, [file('A.NEF', 5_000)]), [], 'never handed over twice');
});

test('"only watch for new" skips what was already there', () => {
  const state = startWatching([file('old.jpg', 10)], false);
  lookAgain(state, [file('old.jpg', 10), file('new.jpg', 10)]);
  assert.deepEqual(lookAgain(state, [file('old.jpg', 10), file('new.jpg', 10)]).map((f) => f.name), ['new.jpg']);
});

test('"import what is there too" takes existing photos after a settle', () => {
  const state = startWatching([file('old.jpg', 10)], true);
  lookAgain(state, [file('old.jpg', 10)]);
  assert.deepEqual(lookAgain(state, [file('old.jpg', 10)]).map((f) => f.name), ['old.jpg']);
});

test('other files, hidden files and empty files are ignored', () => {
  const state = startWatching([], true);
  const listing = [file('notes.txt', 9), file('.DS_Store', 9), file('.hidden.jpg', 9), file('empty.nef', 0), file('A.NEF', 9), file('b.jpg', 9)];
  lookAgain(state, listing);
  assert.deepEqual(lookAgain(state, listing).map((f) => f.name), ['A.NEF', 'b.jpg']);
});

test('a transfer that is cancelled and restarted is not read early', () => {
  const state = startWatching([], true);
  lookAgain(state, [file('x.jpg', 100)]);
  lookAgain(state, []);
  assert.deepEqual(lookAgain(state, [file('x.jpg', 100)]), [], 'the first look after it returns only records it');
  assert.deepEqual(lookAgain(state, [file('x.jpg', 100)]).map((f) => f.name), ['x.jpg']);
});

test('several photos arrive in the order they were taken', () => {
  const state = startWatching([], true);
  const listing = [file('b.jpg', 5, 20), file('a.jpg', 5, 30), file('c.jpg', 5, 10)];
  lookAgain(state, listing);
  assert.deepEqual(lookAgain(state, listing).map((f) => f.name), ['c.jpg', 'b.jpg', 'a.jpg']);
});
