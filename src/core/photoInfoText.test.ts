import test from 'node:test';
import assert from 'node:assert/strict';
import { photoInfoText } from './photoInfoText';
import type { PhotoFrame } from './types';

test('photo info is legible plain text without location or private file paths', () => {
  const frame = {
    filename: 'osprey.NEF', decision: 'keep', rating: 4,
    exif: { camera: 'Nikon Z8', lens: '180–600mm', iso: 3200, shutterSpeed: '1/1600', width: 8256, height: 5504, gpsLatitude: 50.0, serialNumber: 'secret' },
    stableKey: 'local-file:///Users/photographer/private/osprey.NEF',
  } as unknown as PhotoFrame;
  const text = photoInfoText(frame);
  assert.match(text, /File: osprey.NEF/);
  assert.match(text, /Camera: Nikon Z8/);
  assert.match(text, /ISO: 3200/);
  assert.match(text, /Rating: 4\/5/);
  assert.match(text, /Decision: Keep/);
  assert.doesNotMatch(text, /gps|secret|Users\/photographer|50.0/i);
});

test('missing metadata is omitted, not displayed as undefined or blank labels', () => {
  const frame = { filename: 'bird.jpg', decision: 'unreviewed', exif: {} } as PhotoFrame;
  assert.equal(photoInfoText(frame), 'File: bird.jpg');
});
