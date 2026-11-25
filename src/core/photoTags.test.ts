import test from 'node:test';
import assert from 'node:assert/strict';
import { declinePhotoTag, hasPhotoTag, mergePhotoTags, photoTagSearchWords, photoTagsOf, readPhotoTags, tagWords, withoutLocation, type PhotoTag } from './photoTags';
import type { PhotoFrame } from './types';

const frame = (extra: Partial<PhotoFrame> = {}) => ({ stableKey: 'shoot/a.jpg', exif: {}, ...extra }) as Pick<PhotoFrame, 'stableKey' | 'photoTags' | 'removedAt' | 'exif'>;
const golden: PhotoTag = { id: 'light.golden-hour', facet: 'light', source: 'computed' };
const fog: PhotoTag = { id: 'weather.fog', facet: 'weather', source: 'clip', score: 0.91234 };
const heli: PhotoTag = { id: 'vehicle.helicopter', facet: 'vehicle', source: 'clip', score: 0.8 };

test('a lane writes its tags and a re-run replaces only its own facets', () => {
  let photo = mergePhotoTags(frame(), 'scene', ['light', 'weather'], [golden, fog], 'scene-v1', 1);
  assert.deepEqual(photoTagsOf(photo).map((tag) => tag.id), ['light.golden-hour', 'weather.fog']);
  assert.equal(photoTagsOf(photo, 'weather')[0].score, 0.912);
  photo = mergePhotoTags(photo, 'scene', ['weather'], [], 'scene-v1', 2);
  assert.deepEqual(photoTagsOf(photo).map((tag) => tag.id), ['light.golden-hour']);
});

test('two lanes never overwrite each other', () => {
  let photo = mergePhotoTags(frame(), 'scene', ['light'], [golden], 'scene-v1', 1);
  photo = mergePhotoTags(photo, 'vehicles', ['vehicle'], [heli], 'vehicles-v1', 2);
  photo = mergePhotoTags(photo, 'scene', ['light', 'weather'], [fog], 'scene-v1', 3);
  assert.deepEqual(photoTagsOf(photo).map((tag) => tag.id).sort(), ['vehicle.helicopter', 'weather.fog']);
  // A lane cannot take over a tag another lane gave, nor write a facet it did not name.
  photo = mergePhotoTags(photo, 'scene', ['weather'], [{ ...heli, facet: 'weather' }], 'scene-v1', 4);
  assert.ok(hasPhotoTag(photo, 'vehicle.helicopter'));
  assert.equal(photoTagsOf(photo, 'vehicle')[0].source, 'clip');
});

test('a removed tag is never added again, by any lane', () => {
  let photo = mergePhotoTags(frame(), 'scene', ['weather'], [fog], 'scene-v1', 1);
  photo = declinePhotoTag(photo, 'weather.fog');
  assert.equal(hasPhotoTag(photo, 'weather.fog'), false);
  photo = mergePhotoTags(photo, 'scene', ['weather'], [fog], 'scene-v2', 2);
  assert.equal(hasPhotoTag(photo, 'weather.fog'), false);
  assert.deepEqual(readPhotoTags(photo)?.declined, ['weather.fog']);
});

test('malformed tags, removed photos and tags for another file are ignored', () => {
  const photo = mergePhotoTags(frame(), 'scene', ['light'], [{ id: 'Not An Id', facet: 'light', source: 'clip' }, { ...golden, facet: 'nope' as never }], 'scene-v1');
  assert.deepEqual(photoTagsOf(photo), []);
  const removed = frame({ removedAt: 5 });
  assert.equal(mergePhotoTags(removed, 'scene', ['light'], [golden], 'scene-v1'), removed);
  const moved = { ...mergePhotoTags(frame(), 'scene', ['light'], [golden], 'scene-v1'), stableKey: 'shoot/b.jpg' };
  assert.deepEqual(photoTagsOf(moved), []);
});

test('nothing changes when a lane re-runs with the same answer', () => {
  const photo = mergePhotoTags(frame(), 'scene', ['light'], [golden], 'scene-v1', 1);
  assert.equal(mergePhotoTags(photo, 'scene', ['light'], [golden], 'scene-v1', 2), photo);
});

test('search finds a tag in the person\'s language and in English; proper nouns stay as they are', () => {
  let photo = mergePhotoTags(frame(), 'scene', ['light'], [golden], 'scene-v1');
  photo = mergePhotoTags(photo, 'places', ['place'], [{ id: 'place.gn.2643743', facet: 'place', source: 'gps', name: 'London' }], 'places-v1');
  const words = photoTagSearchWords(photo, (id) => (id === 'light.golden-hour' ? 'Heure dorée' : undefined), (id) => (id === 'light.golden-hour' ? 'Golden hour' : undefined));
  assert.deepEqual(words.sort(), ['Golden hour', 'Heure dorée', 'London']);
});

test('location never leaves the device: no GPS and no place or landmark tags in a copy for a backup', () => {
  let photo = { ...frame(), exif: { camera: 'Z 8', gps: { latitude: 52.6, longitude: -3.8 } } } as Pick<PhotoFrame, 'stableKey' | 'photoTags' | 'removedAt' | 'exif'>;
  photo = mergePhotoTags(photo, 'places', ['place', 'landmark'], [
    { id: 'place.gn.2643743', facet: 'place', source: 'gps', name: 'London' },
    { id: 'landmark.mach-loop.cad-west', facet: 'landmark', source: 'curated', name: 'Cad West' },
  ], 'places-v1');
  photo = mergePhotoTags(photo, 'scene', ['light'], [golden], 'scene-v1');
  const safe = withoutLocation(photo);
  assert.deepEqual(safe.exif, { camera: 'Z 8' });
  assert.deepEqual(photoTagsOf(safe).map((tag) => tag.id), ['light.golden-hour']);
  assert.ok(photo.exif.gps, 'the device copy keeps its GPS');
});

test('markings keep their text, a road number plate is never stored, and a hedged tag says "probably"', () => {
  let photo = mergePhotoTags(frame(), 'vehicles', ['vehicle', 'marking'], [
    { id: 'marking.reg.zj914', facet: 'marking', source: 'ocr', name: 'ZJ914' },
    { id: 'marking.plate.ab12cde', facet: 'marking', source: 'ocr', name: 'AB12 CDE' },
    { id: 'marking.plate.ie', facet: 'marking', source: 'ocr', name: '191-D-12345' },
    { id: 'vehicle.type.typhoon', facet: 'vehicle', source: 'clip', name: 'Typhoon', hedged: true },
    { id: 'vehicle.kind.military-jet', facet: 'vehicle', source: 'burst', fromFrameId: 'f1' },
  ], 'vehicles-v1');
  assert.deepEqual(photoTagsOf(photo).map((tag) => tag.id), ['marking.reg.zj914', 'vehicle.type.typhoon', 'vehicle.kind.military-jet']);
  assert.equal(photoTagsOf(photo, 'vehicle')[1].fromFrameId, 'f1');
  const typhoon = photoTagsOf(photo, 'vehicle')[0];
  assert.equal(tagWords(typhoon, () => undefined, (what) => `${what} (probably)`), 'Typhoon (probably)');
  photo = declinePhotoTag(photo, 'marking.reg.zj914');
  assert.equal(hasPhotoTag(photo, 'marking.reg.zj914'), false);
});
