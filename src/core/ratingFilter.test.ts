import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeRatingFilter, describeRatingFilter, encodeRatingFilter, matchesRating, ratingOf } from './ratingFilter';
import { filterFrames } from './cullingEngine';
import type { PhotoFrame } from './types';

const photo = (rating?: number, embedded?: number, decision: PhotoFrame['decision'] = 'unreviewed') =>
  ({ id: `${rating}-${embedded}`, filename: 'a.jpg', decision, rating, exif: { rating: embedded } } as PhotoFrame);

test('the shown rating is the user rating first, then the embedded one, then none', () => {
  assert.equal(ratingOf(photo(4, 2)), 4);
  assert.equal(ratingOf(photo(undefined, 2)), 2);
  assert.equal(ratingOf(photo()), 0);
  assert.equal(ratingOf(photo(0, 5)), 0, 'an explicit zero is a choice, not a missing value');
});

test('at least and exactly behave as described, and no filter matches everything', () => {
  assert.equal(matchesRating(photo(3), { mode: 'atLeast', value: 3 }), true);
  assert.equal(matchesRating(photo(2), { mode: 'atLeast', value: 3 }), false);
  assert.equal(matchesRating(photo(4), { mode: 'exactly', value: 3 }), false);
  assert.equal(matchesRating(photo(), { mode: 'exactly', value: 0 }), true);
  assert.equal(matchesRating(photo(1), null), true);
  assert.equal(matchesRating(photo(1), undefined), true);
});

test('filter values round-trip through the select and reject nonsense', () => {
  for (const filter of [{ mode: 'atLeast', value: 4 }, { mode: 'exactly', value: 0 }] as const) {
    assert.deepEqual(decodeRatingFilter(encodeRatingFilter(filter)), filter);
  }
  assert.equal(encodeRatingFilter(null), 'any');
  assert.equal(decodeRatingFilter('any'), null);
  assert.equal(decodeRatingFilter('min:9'), null);
  assert.equal(decodeRatingFilter('drop table'), null);
  assert.equal(describeRatingFilter({ mode: 'atLeast', value: 3 }), '3★ or more');
  assert.equal(describeRatingFilter({ mode: 'exactly', value: 0 }), 'Unrated');
});

test('the rating filter combines with the collection and the search', () => {
  const frames = [photo(5, undefined, 'keep'), photo(2, undefined, 'keep'), photo(5, undefined, 'reject')];
  assert.equal(filterFrames(frames, 'keep', '', { mode: 'atLeast', value: 4 }).length, 1);
  assert.equal(filterFrames(frames, 'all', '', { mode: 'atLeast', value: 4 }).length, 2);
  assert.equal(filterFrames(frames, 'all', 'a.jpg', { mode: 'exactly', value: 2 }).length, 1);
  assert.equal(filterFrames(frames, 'all', '').length, 3);
});
