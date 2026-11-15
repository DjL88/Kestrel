import test from 'node:test';
import assert from 'node:assert/strict';
import { KEEP_NAMES, sequenceNumber, shortNumber, stemFor } from './exportNaming';
import { NO_OVERLAY, overlayLines, settingsLine } from './exportOverlay';

test('the short number comes from the end of the camera file name', () => {
  assert.equal(shortNumber('DSC_0107.NEF'), '0107');
  assert.equal(shortNumber('Z8A_0002.NEF'), '0002');
  assert.equal(shortNumber('IMG_20261114_123456.JPG'), '3456');
  assert.equal(shortNumber('Screenshot 2026-11-15 at 08.06.57.png'), '57');
  assert.equal(shortNumber('holiday.jpg'), null);
});

test('names: keep, name plus original number, name plus sequence', () => {
  assert.equal(stemFor(KEEP_NAMES, 'DSC_0107.NEF', 0, 3), undefined);
  assert.equal(stemFor({ name: 'Red Kite', numbers: 'original' }, 'DSC_0107.NEF', 0, 3), 'Red-Kite-0107');
  assert.equal(stemFor({ name: 'Red Kite', numbers: 'sequence' }, 'DSC_0107.NEF', 1, 12), 'Red-Kite-02');
  assert.equal(stemFor({ name: 'Red Kite', numbers: 'sequence' }, 'DSC_0107.NEF', 0, 120), 'Red-Kite-001');
  assert.equal(stemFor({ name: 'Red Kite', numbers: 'original' }, 'holiday.jpg', 4, 9), 'Red-Kite-05', 'no digits in the name: use the sequence');
  assert.equal(stemFor({ name: 'Solo', numbers: 'sequence' }, 'a.jpg', 0, 1), 'Solo', 'one photo needs no number');
  assert.equal(stemFor({ name: ' a/b:c*? ', numbers: 'sequence' }, 'a.jpg', 0, 2), 'abc-01', 'unsafe characters are dropped');
  assert.equal(stemFor({ name: '   ', numbers: 'original' }, 'DSC_0107.NEF', 0, 3), undefined);
  assert.equal(sequenceNumber(8, 9), '09');
});

test('the overlay prints only what the photo records and what is switched on', () => {
  const exif = { camera: 'NIKON Z 8', lens: 'NIKKOR Z 400mm f/4.5', focalLengthMm: 400, apertureF: 5.6, shutterSpeed: '1/2000', iso: 800, capturedAtMs: Date.UTC(2026, 10, 14, 12) };
  assert.deepEqual(overlayLines(exif, NO_OVERLAY), [], 'off by default');
  const on = { ...NO_OVERLAY, on: true };
  assert.deepEqual(overlayLines(exif, on), ['NIKON Z 8', 'NIKKOR Z 400mm f/4.5', '400mm · ƒ/5.6 · 1/2000s · ISO 800']);
  assert.deepEqual(overlayLines(exif, { ...on, camera: false, lens: false, date: true }), ['400mm · ƒ/5.6 · 1/2000s · ISO 800', '14 November 2026']);
  assert.deepEqual(overlayLines({ iso: 100 }, { ...on, date: true }), ['ISO 100'], 'missing values leave no gaps');
  assert.deepEqual(overlayLines({}, on), []);
  assert.equal(settingsLine({ apertureF: 8, shutterSpeed: '1/9s' }), 'ƒ/8 · 1/9s');
});
