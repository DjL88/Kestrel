import test from 'node:test';
import assert from 'node:assert/strict';
import type { Photo } from '../contract';
import { filterPhotos, tagChoices } from './studioMath';

const photo = (id: string, tags: NonNullable<Photo['photoTags']>) => ({
  id, filename: `${id}.jpg`, title: id, category: '', decision: 'unreviewed', rating: 0,
  exif: { camera: '', lens: '' }, photoTags: tags,
}) as unknown as Photo;
const golden = { id: 'light.golden-hour', facet: 'light' as const, label: 'Heure dorée', words: ['Heure dorée', 'Golden hour'] };
const fog = { id: 'weather.fog', facet: 'weather' as const, label: 'Brouillard ou brume', words: ['Brouillard ou brume', 'Fog or mist'] };
const photos = [photo('a', [golden]), photo('b', [golden, fog]), photo('c', [])];

test('search finds tags in the person\'s language and in English', () => {
  assert.deepEqual(filterPhotos(photos, 'all', 'golden hour').map((p) => p.id), ['a', 'b']);
  assert.deepEqual(filterPhotos(photos, 'all', 'brume').map((p) => p.id), ['b']);
});

test('the tag filter shows only photos with that tag', () => {
  assert.deepEqual(filterPhotos(photos, 'all', '', 'weather.fog').map((p) => p.id), ['b']);
  assert.deepEqual(filterPhotos(photos, 'all', '', null).map((p) => p.id), ['a', 'b', 'c']);
});

test('the filter lists only tags some photo has, by kind, with counts', () => {
  assert.deepEqual(tagChoices(photos), [
    { facet: 'light', tags: [{ id: 'light.golden-hour', label: 'Heure dorée', count: 2 }] },
    { facet: 'weather', tags: [{ id: 'weather.fog', label: 'Brouillard ou brume', count: 1 }] },
  ]);
  assert.deepEqual(tagChoices([photo('c', [])]), []);
});
