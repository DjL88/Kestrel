import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CRITERIA, MAX_SAVED_VIEWS, SAVED_VIEWS_KEY, cleanViewName, deleteView, loadSavedViews, matchingView, nextToReview,
  parseSavedViews, readCriteria, saveView, serialiseSavedViews, storeSavedViews, type SavedView, type ViewCriteria,
} from './savedViews.ts';

const birds: ViewCriteria = { filter: 'to-review', search: 'kestrel', minRating: 3, sort: 'captured-newest', tag: 'species:falco-tinnunculus' };
let n = 0;
const makeId = () => `view-${++n}`;

test('saving a view keeps every filter field exactly and round-trips through storage text', () => {
  const saved = saveView([], '  Birds   to finish ', birds, makeId);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.view.name, 'Birds to finish');
  assert.deepEqual(saved.view.criteria, birds);
  assert.deepEqual(parseSavedViews(serialiseSavedViews(saved.views)), saved.views);
});

test('saving under an existing name (any case) replaces it in place instead of adding a second', () => {
  const first = saveView([], 'Keepers', birds, makeId);
  assert.ok(first.ok);
  if (!first.ok) return;
  const second = saveView(first.views, 'KEEPERS', DEFAULT_CRITERIA, makeId);
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.equal(second.replaced, true);
  assert.equal(second.views.length, 1);
  assert.equal(second.views[0].id, first.view.id);
  assert.deepEqual(second.views[0].criteria, DEFAULT_CRITERIA);
});

test('an empty name, a full list or criteria the filmstrip does not know are refused, never half-saved', () => {
  assert.deepEqual(saveView([], '   ', birds, makeId), { ok: false, reason: 'empty-name' });
  const full: SavedView[] = Array.from({ length: MAX_SAVED_VIEWS }, (_, i) => ({ id: `v${i}`, name: `View ${i}`, criteria: DEFAULT_CRITERIA }));
  assert.deepEqual(saveView(full, 'One more', birds, makeId), { ok: false, reason: 'full' });
  assert.deepEqual(saveView([], 'Odd', { ...birds, minRating: 7 }, makeId), { ok: false, reason: 'invalid' });
  assert.deepEqual(saveView([], 'Odd', { ...birds, sort: 'random' as never }, makeId), { ok: false, reason: 'invalid' });
});

test('damaged storage keeps the good entries and drops only the bad ones', () => {
  const text = JSON.stringify([
    { id: 'a', name: 'Good', criteria: birds },
    { id: 'b', name: '', criteria: birds },
    { id: 'c', name: 'Bad filter', criteria: { ...birds, filter: 'starred' } },
    { id: 'a', name: 'Duplicate id', criteria: birds },
    'nonsense',
    { id: 'd', name: 'Tagless', criteria: { ...birds, tag: null } },
  ]);
  assert.deepEqual(parseSavedViews(text).map((view) => view.id), ['a', 'd']);
  assert.deepEqual(parseSavedViews('{not json'), []);
  assert.deepEqual(parseSavedViews('{"a":1}'), []);
  assert.deepEqual(parseSavedViews(null), []);
  assert.equal(readCriteria({ ...birds, tag: '' }), null);
  assert.equal(readCriteria({ ...birds, minRating: 2.5 }), null);
});

test('names lose control characters and are capped', () => {
  assert.equal(cleanViewName('a\u0000b\nc'), 'a b c');
  assert.equal(cleanViewName('x'.repeat(100)).length, 60);
});

test('the view matching what is shown is found; deleting removes only that one', () => {
  const views: SavedView[] = [{ id: 'a', name: 'All', criteria: DEFAULT_CRITERIA }, { id: 'b', name: 'Birds', criteria: birds }];
  assert.equal(matchingView(views, { ...birds })?.id, 'b');
  assert.equal(matchingView(views, { ...birds, search: 'robin' }), null);
  assert.deepEqual(deleteView(views, 'a').map((view) => view.id), ['b']);
});

test('storage that throws or is missing never breaks the editor', () => {
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
  assert.deepEqual(loadSavedViews(throwing), []);
  assert.equal(storeSavedViews(throwing, []), false);
  assert.equal(storeSavedViews(null, []), false);
  const box = new Map<string, string>();
  const memory = { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => { box.set(k, v); } };
  const views: SavedView[] = [{ id: 'b', name: 'Birds', criteria: birds }];
  assert.equal(storeSavedViews(memory, views), true);
  assert.ok(box.has(SAVED_VIEWS_KEY));
  assert.deepEqual(loadSavedViews(memory), views);
});

test('next to review skips decided photos, in the shown order, and stops at the end instead of wrapping', () => {
  const shown = [
    { id: '1', decision: 'keep' }, { id: '2', decision: 'unreviewed' }, { id: '3', decision: 'reject' },
    { id: '4', decision: 'keep' }, { id: '5', decision: 'unreviewed' },
  ];
  assert.equal(nextToReview(shown, '2', 1)?.id, '5');
  assert.equal(nextToReview(shown, '5', 1), null);
  assert.equal(nextToReview(shown, '5', -1)?.id, '2');
  assert.equal(nextToReview(shown, '2', -1), null);
  assert.equal(nextToReview(shown, '1', 1)?.id, '2');
  // The current photo is not shown (filtered out): start from the near end in that direction.
  assert.equal(nextToReview(shown, 'gone', 1)?.id, '2');
  assert.equal(nextToReview(shown, null, -1)?.id, '5');
  assert.equal(nextToReview([], '1', 1), null);
});
