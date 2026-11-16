import assert from 'node:assert/strict';
import test from 'node:test';
import { photoMenuItems, ratingFor, targetsFor, type PhotoMenuState } from './photoMenu.ts';

const state = (over: Partial<PhotoMenuState> = {}): PhotoMenuState => ({ decision: 'unreviewed', count: 1, canPaste: false, hasEdit: false, ...over });
const byAction = (s: PhotoMenuState) => Object.fromEntries(photoMenuItems(s).map((item) => [item.action, item]));

test('a single unreviewed photo offers the everyday actions, with sensible ones greyed out', () => {
  const items = byAction(state());
  assert.equal(Boolean(items.edit.disabled), false);
  assert.equal(Boolean(items.unreview.disabled), true, 'already to review');
  assert.equal(Boolean(items.keep.disabled), false);
  assert.equal(Boolean(items.paste.disabled), true, 'nothing copied yet');
  assert.equal(Boolean(items.copy.disabled), true, 'no adjustments to copy');
  assert.equal(items.remove, undefined, 'removing is only for photos in the Trash');
});

test('the current decision is greyed, and a trashed photo can be removed from the library', () => {
  assert.equal(Boolean(byAction(state({ decision: 'keep' })).keep.disabled), true);
  const trashed = byAction(state({ decision: 'reject' }));
  assert.equal(Boolean(trashed.trash.disabled), true);
  assert.ok(trashed.remove);
});

test('copy needs adjustments and paste needs something copied', () => {
  const ready = byAction(state({ hasEdit: true, canPaste: true }));
  assert.equal(Boolean(ready.copy.disabled), false);
  assert.equal(Boolean(ready.paste.disabled), false);
});

test('with several photos selected the labels say how many, and single-photo actions are off', () => {
  const items = byAction(state({ count: 3, canPaste: true, hasEdit: true }));
  assert.match(items.keep.label, /3 photos/);
  assert.match(items.export.label, /3 photos/);
  assert.equal(items.edit.disabled, true);
  assert.equal(items.info.disabled, true);
  assert.equal(items.copy.disabled, true);
  assert.equal(Boolean(items.keep.disabled), false, 'Keep still works on a mixed selection');
});

test('star ratings sit together in a row, one to five, with a way to clear', () => {
  const stars = photoMenuItems(state()).filter((item) => item.inline);
  assert.deepEqual(stars.map((item) => ratingFor(item.action)), [1, 2, 3, 4, 5]);
  assert.equal(ratingFor('rate0'), 0);
  assert.equal(ratingFor('keep'), null);
});

test('an action applies to the whole selection only when the clicked photo is part of it', () => {
  const selected = new Set(['a', 'b', 'c']);
  assert.deepEqual(targetsFor('b', selected, true).sort(), ['a', 'b', 'c']);
  assert.deepEqual(targetsFor('z', selected, true), ['z']);
  assert.deepEqual(targetsFor('b', selected, false), ['b']);
  assert.deepEqual(targetsFor('a', new Set(['a']), true), ['a']);
});
