import test from 'node:test';
import assert from 'node:assert/strict';
import { bracketsByFrame, exposureStops, findExposureBrackets } from './hdrBracket';
import { isAutoBracket } from './exifParser';
import type { ExifMetadata, PhotoFrame } from './types';

const base: ExifMetadata = { camera: 'Nikon Z6', width: 6000, height: 4000, focalLengthMm: 24, apertureF: 8, iso: 100, exposureSeconds: 1 / 125 };
let seq = 0;
const shot = (id: string, at: number, exif: Partial<ExifMetadata> = {}): PhotoFrame =>
  ({ id, stableKey: id, filename: `${id}.nef`, sequenceIndex: ++seq, decision: 'undecided', exif: { ...base, capturedAtMs: at, ...exif } }) as unknown as PhotoFrame;

test('exposure in stops from shutter, aperture and ISO, else the recorded compensation', () => {
  assert.equal(exposureStops({ exposureSeconds: 1, apertureF: 1, iso: 100 }), 0);
  assert.ok(Math.abs(exposureStops({ exposureSeconds: 1 / 30, apertureF: 8, iso: 100 })! - exposureStops({ exposureSeconds: 1 / 125, apertureF: 8, iso: 100 })! - 2) < 0.1);
  assert.equal(exposureStops({ exposureBiasEv: -1.7 }), -1.7);
  assert.equal(exposureStops({}), null);
});

test('a camera bracket (0, −2, +2) is found and labelled from the middle exposure', () => {
  const frames = [shot('a', 1000, { autoBracket: true }), shot('b', 1200, { autoBracket: true, exposureSeconds: 1 / 500 }), shot('c', 1400, { autoBracket: true, exposureSeconds: 1 / 30 })];
  const [bracket] = findExposureBrackets(frames);
  assert.deepEqual(bracket.frameIds, ['a', 'b', 'c']);
  assert.deepEqual(bracket.ev, [0, -2, 2]);
  assert.equal(bracket.fromCamera, true);
});

test('continuous bracketing splits at the repeated exposure', () => {
  const evs = [1 / 125, 1 / 500, 1 / 30, 1 / 125, 1 / 500, 1 / 30];
  const brackets = findExposureBrackets(evs.map((t, i) => shot(`f${i}`, 1000 + i * 150, { autoBracket: true, exposureSeconds: t })));
  assert.deepEqual(brackets.map((b) => b.frameIds), [['f0', 'f1', 'f2'], ['f3', 'f4', 'f5']]);
});

test('an ordinary burst, a long gap, a zoom change or another camera is not a bracket', () => {
  const burst = [0, 1, 2, 3].map((i) => shot(`b${i}`, 1000 + i * 100, { exposureSeconds: 1 / (125 + i * 5) }));
  assert.equal(findExposureBrackets(burst).length, 0);
  assert.equal(findExposureBrackets([shot('g1', 0), shot('g2', 10_000, { exposureSeconds: 1 / 30 })]).length, 0);
  assert.equal(findExposureBrackets([shot('z1', 0), shot('z2', 200, { exposureSeconds: 1 / 30, focalLengthMm: 70 })]).length, 0);
  assert.equal(findExposureBrackets([shot('c1', 0), shot('c2', 200, { exposureSeconds: 1 / 30, camera: 'Canon R5' })]).length, 0);
});

test('a hand-made bracket without the camera mark needs a clear spread', () => {
  const found = findExposureBrackets([shot('h1', 0, { exposureSeconds: 1 / 250 }), shot('h2', 600, { exposureSeconds: 1 / 60 })]);
  assert.equal(found.length, 1);
  assert.equal(found[0].fromCamera, false);
  assert.equal(bracketsByFrame([shot('h1', 0, { exposureSeconds: 1 / 250 }), shot('h2', 600, { exposureSeconds: 1 / 60 })]).get('h2')?.frameIds.length, 2);
});

test('removed and demo photos are left out', () => {
  const frames = [shot('a', 0, { autoBracket: true }), { ...shot('b', 200, { autoBracket: true, exposureSeconds: 1 / 30 }), removedAt: 5 } as PhotoFrame];
  assert.equal(findExposureBrackets(frames).length, 0);
});

test('EXIF Exposure mode Auto bracket is read in either form', () => {
  assert.equal(isAutoBracket('Auto bracket'), true);
  assert.equal(isAutoBracket(2), true);
  assert.equal(isAutoBracket('Auto'), false);
  assert.equal(isAutoBracket(0), false);
});
