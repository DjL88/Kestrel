import assert from 'node:assert/strict';
import test from 'node:test';
import type { Photo } from '../contract';
import { fieldChoices, formatOverlayRowText, moveInList, overlayFieldValue } from './overlayFields.ts';

const photo = (patch: Partial<Photo> = {}, exif: Partial<Photo['exif']> = {}): Photo => ({
  id: 'p', filename: 'DSC_0042.NEF', title: 'DSC_0042', previewUrl: '', thumbUrl: '', state: 'ready', decision: 'unreviewed', originalConnected: true,
  rating: 0, category: '', sharpnessScore: 0, activeGroupId: 'g', editGroups: [], sizes: [], videoZoom: { enabled: false, focalX: 50, focalY: 50, direction: 'in', durationSec: 5 }, masks: [],
  assistCritique: { subjectNote: '', colourConfidence: '', kelvinEstimate: '', suggestions: [] },
  exif: { camera: 'Nikon Z 9', lens: 'NIKKOR Z 400mm f/4.5', aperture: 'f/5.6', shutter: '1/2000s', iso: 800, focalLength: '400mm', capturedAt: '24/11/2026, 14:05:09', fileFormat: 'NEF', fileSizeMb: 0, dimensions: '8256 × 5504', colourProfile: 'Not recorded', ...exif },
  ...patch,
} as Photo);

const row = (fields: Photo['editGroups'][number]['overlay']['rows'][number]['fields'], customText = '', uppercase = false) => ({ fields, customText, uppercase });

test('a row joins its fields in the chosen order', () => {
  assert.equal(formatOverlayRowText(row(['iso', 'camera', 'aperture']), photo()), 'ISO 800  ·  Nikon Z 9  ·  f/5.6');
  assert.equal(formatOverlayRowText(row(['camera'], '', true), photo()), 'NIKON Z 9');
});

test('a field the file did not record is left out, never printed as "Not recorded" or ISO 0', () => {
  const bare = photo({}, { camera: 'Not recorded', lens: 'Not recorded', iso: 0, aperture: 'Not recorded' });
  assert.equal(formatOverlayRowText(row(['camera', 'lens', 'iso', 'aperture', 'shutter']), bare), '1/2000s');
  assert.equal(formatOverlayRowText(row(['camera', 'iso']), bare), '');
  assert.equal(overlayFieldValue('iso', bare), null);
});

test('file and subject fields come from the photo and its detection', () => {
  const found = photo({ speciesLabel: 'Red kite', category: 'bird', rating: 4 });
  assert.equal(overlayFieldValue('species', found), 'Red kite');
  assert.equal(overlayFieldValue('category', found), 'bird');
  assert.equal(overlayFieldValue('capturedAt', found), '24/11/2026');
  assert.equal(overlayFieldValue('filename', found), 'DSC_0042.NEF');
  assert.equal(overlayFieldValue('rating', found), '★★★★');
  assert.equal(overlayFieldValue('species', photo()), null, 'no detection, no subject');
  assert.equal(formatOverlayRowText(row(['species', 'custom'], '  © Dave  '), found), 'Red kite  ·  © Dave');
});

test('the picker offers each field once, with this photo’s value', () => {
  const choices = fieldChoices({ fields: ['camera', 'lens'], customText: '' }, photo({}, { iso: 0 }));
  assert.equal(choices.some((choice) => choice.id === 'camera'), false);
  assert.equal(choices.find((choice) => choice.id === 'iso')?.value, null);
  assert.equal(choices.find((choice) => choice.id === 'aperture')?.value, 'f/5.6');
});

test('moving an item stops at either end', () => {
  assert.deepEqual(moveInList(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
  assert.deepEqual(moveInList(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c']);
  assert.deepEqual(moveInList(['a', 'b', 'c'], 2, 1), ['a', 'b', 'c']);
});
