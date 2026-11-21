import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { expect } from '../core/testExpect.ts';
import { decodeHeifPixels, HeifUndecodableError, type HeifPixels } from './heifWasmCore.ts';
import { parseImageExif } from '../core/exifParser.ts';

// tests/fixtures/make_heic_fixture.py: 96 x 64, red left half, blue right half, green square top-left. Wholly synthetic.
const FIXTURE = new Uint8Array(readFileSync(new URL('../../tests/fixtures/synthetic-heic.heic', import.meta.url)));
const libheif = async () => (await import('libheif-js/libheif-wasm/libheif-bundle.mjs')).default;

const pixel = (picture: HeifPixels, x: number, y: number) =>
  Array.from(picture.data.slice((y * picture.width + x) * 4, (y * picture.width + x) * 4 + 4));
const near = (actual: number[], expected: number[], label: string) => {
  for (let i = 0; i < 3; i += 1) assert.ok(Math.abs(actual[i] - expected[i]) <= 40, `${label}: ${actual} vs ${expected}`);
};

/**
 * The fixture with an `irot` property (rotate 90° anticlockwise) added to its picture: how iPhones and cameras record a
 * portrait photo in HEIF. Built here, byte by byte, so the test needs no second binary fixture. Every box that holds
 * the new bytes grows, and the item offsets after `meta` move along with them.
 */
function rotatedFixture(): Uint8Array {
  const src = FIXTURE;
  const view = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const type = (at: number) => String.fromCharCode(...src.subarray(at + 4, at + 8));
  const child = (start: number, end: number, wanted: string) => {
    for (let at = start; at + 8 <= end; at += view.getUint32(at)) if (type(at) === wanted) return at;
    throw new Error(`no ${wanted}`);
  };
  const meta = child(0, src.length, 'meta');
  const metaEnd = meta + view.getUint32(meta);
  const iprp = child(meta + 12, metaEnd, 'iprp');
  const ipco = child(iprp + 8, iprp + view.getUint32(iprp), 'ipco');
  const ipcoEnd = ipco + view.getUint32(ipco);
  const ipma = child(iprp + 8, iprp + view.getUint32(iprp), 'ipma');
  const iloc = child(meta + 12, metaEnd, 'iloc');
  // ipma version 0, flags 0, one entry: item 1 with three one-byte associations. irot becomes property 4.
  assert.equal(view.getUint32(ipma + 8), 0);
  assert.equal(view.getUint32(ipma + 12), 1);
  const countAt = ipma + 18;
  const associations = src[countAt];
  const ipmaEnd = countAt + 1 + associations;
  let properties = 0;
  for (let at = ipco + 8; at < ipcoEnd; at += view.getUint32(at)) properties += 1;

  const irot = new Uint8Array([0, 0, 0, 9, ...[...'irot'].map((c) => c.charCodeAt(0)), 1]);
  const association = new Uint8Array([0x80 | (properties + 1)]);
  const out = new Uint8Array(src.length + irot.length + association.length);
  out.set(src.subarray(0, ipcoEnd), 0);
  out.set(irot, ipcoEnd);
  out.set(src.subarray(ipcoEnd, ipmaEnd), ipcoEnd + irot.length);
  out.set(association, ipmaEnd + irot.length);
  out.set(src.subarray(ipmaEnd), ipmaEnd + irot.length + association.length);
  const grown = new DataView(out.buffer);
  const grow = (at: number, by: number) => grown.setUint32(at, grown.getUint32(at) + by);
  const total = irot.length + association.length;
  grow(meta, total);
  grow(iprp, total);
  grow(ipco, irot.length);
  grow(ipma + irot.length, association.length);
  out[countAt + irot.length] = associations + 1;
  // iloc (before ipco, so unmoved) version 0 with 4-byte base offsets: shift every item by what meta gained.
  assert.equal(src[iloc + 8], 0);
  assert.equal(src[iloc + 13] >> 4, 4);
  let at = iloc + 14;
  const items = view.getUint16(at);
  at += 2;
  const extentBytes = (src[iloc + 12] >> 4) + (src[iloc + 12] & 15);
  for (let item = 0; item < items; item += 1) {
    at += 4; // item_ID, data_reference_index
    grow(at, total);
    at += 4;
    const extents = view.getUint16(at);
    at += 2 + extents * extentBytes;
  }
  return out;
}

describe('the bundled HEIF decoder (libheif-js 1.23.5, WebAssembly)', () => {
  it('decodes a HEIC photo at full size, the right way up', async () => {
    const picture = await decodeHeifPixels(await libheif(), FIXTURE);
    expect(picture.width).toBe(96);
    expect(picture.height).toBe(64);
    near(pixel(picture, 4, 4), [30, 200, 60], 'green corner, top left');
    near(pixel(picture, 10, 40), [220, 30, 30], 'red left half');
    near(pixel(picture, 80, 40), [30, 60, 220], 'blue right half');
    expect(pixel(picture, 80, 40)[3]).toBe(255);
  });

  it('applies the rotation stored in the file, once', async () => {
    const picture = await decodeHeifPixels(await libheif(), rotatedFixture());
    // 90° anticlockwise: 64 wide, 96 high; the top-left corner is now bottom-left, the right half is now the top.
    expect(picture.width).toBe(64);
    expect(picture.height).toBe(96);
    near(pixel(picture, 4, 91), [30, 200, 60], 'green corner, now bottom left');
    near(pixel(picture, 40, 10), [30, 60, 220], 'blue, now the top half');
    near(pixel(picture, 40, 80), [220, 30, 30], 'red, now the bottom half');
  });

  it('fails with a plain message for a file that is not HEIF or is cut short, never a picture', async () => {
    const factory = await libheif();
    await assert.rejects(decodeHeifPixels(factory, new Uint8Array(4096).fill(7)), (error) =>
      error instanceof HeifUndecodableError && /could not be decoded/.test(error.message));
    await assert.rejects(decodeHeifPixels(factory, FIXTURE.slice(0, FIXTURE.length - 120)), HeifUndecodableError);
  });
});

describe('HEIC photo info', () => {
  it('reads capture time, camera and ISO, and calls the format what it is', async () => {
    const exif = await parseImageExif(new Blob([FIXTURE]), 'IMG_0001.HEIC');
    expect(exif.camera).toBe('Kestrel Test');
    expect(exif.iso).toBe(200);
    expect(new Date(exif.capturedAtMs!).getFullYear()).toBe(2026);
    expect(exif.formatLabel).toBe('HEIC');
    expect(exif.isEmbeddedPreviewOnly).toBe(false);
    // Pillow stores the fixture's exposure time as two SHORTs rather than a RATIONAL, so it is (rightly) not shown.
    expect(exif.shutterSpeed).toBeUndefined();
  });

  it('a HEIF with no readable EXIF is still a HEIF photo, with unknowns left unknown', async () => {
    const exif = await parseImageExif(new Blob([new Uint8Array(64)]), 'R5_0001.HIF');
    expect(exif.formatLabel).toBe('HIF');
    expect(exif.camera).toBeUndefined();
    expect(exif.capturedAtMs).toBeUndefined();
  });
});

it('damaged HEIF metadata does not invent shooting details or mislabel the file as JPEG', async () => {
  const truncated = FIXTURE.slice(0, 630);
  const exif = await parseImageExif(new Blob([truncated]), 'damaged.HEIC');
  assert.equal(exif.formatLabel, 'HEIC');
  assert.equal(exif.camera, undefined);
  assert.equal(exif.capturedAtMs, undefined);
});
