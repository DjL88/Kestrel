import assert from 'node:assert/strict';
import test from 'node:test';
import { searchByWords, searchTerms } from './wordSearch';

const items = [
  { id: 'dipper-rock', text: 'DSC_0101.NEF White-throated Dipper rock river' },
  { id: 'dipper-water', text: 'DSC_0102.NEF White-throated Dipper water' },
  { id: 'heron', text: 'DSC_0103.NEF Grey Heron rocky shore golden hour' },
  { id: 'hawk', text: 'IMG_2001.JPG Hawk T2 aircraft' },
];

test('little words are left out, so a description searches by its subject words', () => {
  assert.deepEqual(searchTerms('A dipper on a rock'), ['dipper', 'rock']);
  assert.deepEqual(searchTerms('  Golden-hour  photos of the heron '), ['golden', 'hour', 'heron']);
  assert.deepEqual(searchTerms('on the'), ['on', 'the'], 'a query of only little words keeps them');
  assert.deepEqual(searchTerms(''), []);
});

test('every meaningful word must be found, in any order', () => {
  const outcome = searchByWords(items, 'dipper on a rock');
  assert.deepEqual(outcome.complete, ['dipper-rock']);
  assert.deepEqual(outcome.partial, []);
  assert.deepEqual(searchByWords(items, 'rock dipper').complete, ['dipper-rock']);
});

test('plurals and word beginnings match, mid-word fragments do not', () => {
  assert.deepEqual(searchByWords(items, 'dippers').complete, ['dipper-rock', 'dipper-water']);
  assert.deepEqual(searchByWords(items, 'heron on rocks').complete, ['heron']);
  const fragment = searchByWords(items, 'ipper river');
  assert.deepEqual(fragment.complete, [], '"ipper" is not the beginning of any word');
  assert.deepEqual(fragment.partialTerms, ['river']);
});

test('the query as typed still matches anywhere, as before (filenames)', () => {
  assert.deepEqual(searchByWords(items, 'SC_010').complete, ['dipper-rock', 'dipper-water', 'heron']);
  assert.deepEqual(searchByWords(items, 'hawk t2').complete, ['hawk']);
});

test('when no photo holds every word, the photos holding the most words are offered and named', () => {
  const outcome = searchByWords(items, 'dipper on a wall');
  assert.deepEqual(outcome.complete, []);
  assert.deepEqual(outcome.partial, ['dipper-rock', 'dipper-water']);
  assert.deepEqual(outcome.partialTerms, ['dipper']);
  const none = searchByWords(items, 'kingfisher');
  assert.deepEqual([none.complete, none.partial], [[], []]);
});
