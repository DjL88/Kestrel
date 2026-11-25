import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoShootState } from './cullingEngine';
import { rawJpegPairs, withPartners } from './rawJpegPairs';
import type { PhotoFrame } from './types';

const base = createDemoShootState(1).frames[0];
const frame = (id: string, filename: string, extra: Partial<PhotoFrame> = {}): PhotoFrame =>
  ({ ...base, id, filename, stableKey: `card/${filename}`, isDemo: false, removedAt: undefined, exif: { ...base.exif, capturedAtMs: 1000 }, ...extra });

test('one RAW and one JPEG with the same name in the same folder are one shot', () => {
  const pairs = rawJpegPairs([frame('r', 'DSC_0001.NEF'), frame('j', 'dsc_0001.jpg'), frame('o', 'DSC_0002.jpg')]);
  assert.equal(pairs.jpegOf.get('r'), 'j');
  assert.equal(pairs.rawOf.get('j'), 'r');
  assert.equal(pairs.rawOf.has('o'), false);
  assert.deepEqual(withPartners(['r'], pairs).sort(), ['j', 'r']);
  assert.deepEqual(withPartners(['o'], pairs), ['o']);
});

test('anything ambiguous stays as separate photos', () => {
  // Two JPEGs with one RAW, different folders, capture times far apart, or a removed partner: no pair.
  assert.equal(rawJpegPairs([frame('r', 'A.CR3'), frame('j1', 'A.jpg'), frame('j2', 'A.JPEG')]).jpegOf.size, 0);
  assert.equal(rawJpegPairs([frame('r', 'A.CR3'), frame('j', 'A.jpg', { stableKey: 'other/A.jpg' })]).jpegOf.size, 0);
  assert.equal(rawJpegPairs([frame('r', 'A.CR3'), frame('j', 'A.jpg', { exif: { ...base.exif, capturedAtMs: 9000 } })]).jpegOf.size, 0);
  assert.equal(rawJpegPairs([frame('r', 'A.CR3'), frame('j', 'A.jpg', { removedAt: 5 })]).jpegOf.size, 0);
  assert.equal(rawJpegPairs([frame('r', 'A.png'), frame('j', 'A.jpg')]).jpegOf.size, 0, 'a PNG is not a RAW');
});
