import assert from 'node:assert/strict';
import test from 'node:test';
import type { OverlayTextRow, Photo } from '../contract';
import { composeOverlayText, overlayFieldChoices } from './overlayMetadata';

const photo: Pick<Photo, 'exif' | 'filename' | 'speciesLabel' | 'pixelSize'> = {
  filename: 'bird.NEF', speciesLabel: 'Robin', pixelSize: { width: 6000, height: 4000 },
  exif: { camera: 'Nikon Z8', lens: 'Not recorded', aperture: 'f/4', shutter: '1/2000s', iso: 0, focalLength: '600mm', capturedAt: '24 Nov 2026', fileFormat: 'NEF', fileSizeMb: 0, dimensions: 'Not recorded', colourProfile: 'Not recorded' },
};
const row: OverlayTextRow = { id: 'r', fields: ['species', 'lens', 'iso', 'capturedAt', 'dimensions', 'filename'], customText: '', fontId: 'lora', sizePx: 14, uppercase: false, weight: 400, letterSpacing: 0 };

test('preview and export compose only real recorded metadata in selection order', () => {
  assert.equal(composeOverlayText(row, photo), 'Robin  ·  24 Nov 2026  ·  6000 × 4000  ·  bird.NEF');
});
test('picker offers present metadata plus custom text, but not placeholders or already selected fields', () => {
  const fields = overlayFieldChoices(photo, ['camera', 'species']).map(([id]) => id);
  assert.ok(fields.includes('capturedAt') && fields.includes('custom') && fields.includes('dimensions'));
  for (const absent of ['camera', 'species', 'lens', 'iso', 'fileSizeMb', 'colourProfile']) assert.ok(!fields.some(id => id === absent));
});
