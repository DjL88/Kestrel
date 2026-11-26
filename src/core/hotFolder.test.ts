import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyHotFolderState, isHotFolderCandidate, lookAtHotFolder, markHotFolderHandled, type HotFolderFile } from './hotFolder';

const photos = new Set(['jpg', 'cr3', 'nef', 'arw']);
const file = (name: string, size: number, lastModified = 1000): HotFolderFile => ({ key: `/shoot/${name}`, name, size, lastModified });

test('a frame is ready only after two looks see the same size and time', () => {
  const first = lookAtHotFolder(emptyHotFolderState(), [file('IMG_0001.CR3', 100)], photos);
  assert.deepEqual(first.ready, []);
  assert.equal(first.arriving, 1);
  const second = lookAtHotFolder(first.next, [file('IMG_0001.CR3', 100)], photos);
  assert.deepEqual(second.ready.map((f) => f.name), ['IMG_0001.CR3']);
  assert.equal(second.arriving, 0);
});

test('a file still growing, or empty, is never imported half-written', () => {
  let state = lookAtHotFolder(emptyHotFolderState(), [file('a.nef', 10, 1), file('b.nef', 0, 1)], photos).next;
  const growing = lookAtHotFolder(state, [file('a.nef', 20, 2), file('b.nef', 0, 1)], photos);
  assert.deepEqual(growing.ready, []);
  assert.equal(growing.arriving, 2);
  state = growing.next;
  assert.deepEqual(lookAtHotFolder(state, [file('a.nef', 20, 2)], photos).ready.map((f) => f.name), ['a.nef']);
});

test('handled frames are not offered again, and new ones arrive in shooting order', () => {
  let look = lookAtHotFolder(emptyHotFolderState(), [file('2.jpg', 5, 20), file('1.jpg', 5, 10)], photos);
  look = lookAtHotFolder(look.next, [file('2.jpg', 5, 20), file('1.jpg', 5, 10)], photos);
  assert.deepEqual(look.ready.map((f) => f.name), ['1.jpg', '2.jpg']);
  const state = markHotFolderHandled(look.next, look.ready.map((f) => f.key));
  const again = lookAtHotFolder(state, [file('2.jpg', 5, 20), file('1.jpg', 5, 10)], photos);
  assert.deepEqual(again.ready, []);
  assert.equal(again.arriving, 0);
});

test('a frame left unhandled (import was busy) is offered again on the next look', () => {
  let look = lookAtHotFolder(emptyHotFolderState(), [file('x.arw', 9)], photos);
  look = lookAtHotFolder(look.next, [file('x.arw', 9)], photos);
  assert.equal(look.ready.length, 1);
  assert.equal(lookAtHotFolder(look.next, [file('x.arw', 9)], photos).ready.length, 1);
});

test('partial downloads, hidden files and non-photos are left alone', () => {
  for (const name of ['IMG_1.CR3.part', 'IMG_1.jpg.crdownload', '.DS_Store', '._IMG_1.CR3', '~lock.jpg', 'notes.txt', 'IMG_1.tmp', 'README']) {
    assert.equal(isHotFolderCandidate(name, photos), false, name);
  }
  assert.equal(isHotFolderCandidate('IMG_1.CR3', photos), true);
});
