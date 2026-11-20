import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decodeHeifPixels } from './heifWasmCore.ts';
import { parseImageExif } from '../core/exifParser.ts';

// tests/fixtures/make_heic_fixture.py: 96 x 64, red left half, blue right half, green square top-left. Wholly synthetic.
const FIXTURE = new Uint8Array(readFileSync(new URL('../../tests/fixtures/synthetic-heic.heic', import.meta.url)));

const near = (actual: number[], expected: number[], label: string) => {
  for (let i = 0; i < 3; i += 1) assert.ok(Math.abs(actual[i] - expected[i]) <= 40, `${label}: ${actual} vs ${expected}`);
};

test('the bundled libheif decodes a HEIC photo at full size, the right way up', async () => {
  const factory = (await import('libheif-js/libheif-wasm/libheif-bundle.mjs')).default;
  const picture = await decodeHeifPixels(factory, FIXTURE);
  assert.equal(picture.width, 96);
  assert.equal(picture.height, 64);
  const at = (x: number, y: number) => Array.from(picture.data.slice((y * 96 + x) * 4, (y * 96 + x) * 4 + 4));
  near(at(4, 4), [30, 200, 60], 'green corner, top left');
  near(at(10, 40), [220, 30, 30], 'red left half');
  near(at(80, 40), [30, 60, 220], 'blue right half');
  assert.equal(at(80, 40)[3], 255, 'opaque');
});

test('a file that is not HEIF fails with a plain message, never a picture', async () => {
  const factory = (await import('libheif-js/libheif-wasm/libheif-bundle.mjs')).default;
  await assert.rejects(decodeHeifPixels(factory, new Uint8Array(4096).fill(7)), /could not be decoded/);
});

test('capture time and camera are read from a HEIC photo', async () => {
  const exif = await parseImageExif(new Blob([FIXTURE]), 'IMG_0001.HEIC');
  assert.equal(exif.camera, 'Kestrel Test');
  assert.equal(exif.iso, 200);
  assert.equal(exif.shutterSpeed, '1/250s');
  assert.equal(new Date(exif.capturedAtMs!).getFullYear(), 2026);
  assert.equal(exif.formatLabel, 'HEIC');
  assert.equal(exif.isEmbeddedPreviewOnly, false);
});

test('damaged HEIF metadata does not invent shooting details or mislabel the file as JPEG', async () => {
  const truncated = FIXTURE.slice(0, 630);
  const exif = await parseImageExif(new Blob([truncated]), 'damaged.HEIC');
  assert.equal(exif.formatLabel, 'HEIC');
  assert.equal(exif.camera, undefined);
  assert.equal(exif.capturedAtMs, undefined);
});
