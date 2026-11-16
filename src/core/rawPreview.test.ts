import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractRawPreview } from './nefPreview.ts';
import { isRawPreviewFile, PHOTO_ACCEPT, rawFormatOf, rawPreviewLabel } from './rawFormats.ts';

const jpeg = new Uint8Array(await readFile(new URL('../assets/images/demo_red_kite_flight_1794721996053.jpg', import.meta.url)));

/** A TIFF-style RAW whose first directory holds the given tags, with the JPEG placed after a stretch of other data. */
function tiff(tags: [number, number][], at: number, little = true) {
  const head = new Uint8Array(8 + 2 + tags.length * 12 + 4);
  const view = new DataView(head.buffer);
  view.setUint16(0, little ? 0x4949 : 0x4d4d);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, tags.length, little);
  tags.forEach(([tag, value], i) => {
    const entry = 10 + i * 12;
    view.setUint16(entry, tag, little);
    view.setUint16(entry + 2, 4, little);
    view.setUint32(entry + 4, 1, little);
    view.setUint32(entry + 8, value, little);
  });
  return new Blob([head, new Uint8Array(at - head.length), jpeg, new Uint8Array(512)]);
}

const sameBytes = async (preview: Blob | null) => {
  assert.equal(preview?.type, 'image/jpeg');
  assert.deepEqual(new Uint8Array(await preview!.arrayBuffer()), jpeg);
};

test('Sony ARW: the preview named by the first directory is found', async () => {
  await sameBytes(await extractRawPreview(tiff([[0x0201, 40_000], [0x0202, jpeg.length]], 40_000)));
});

test('Canon CR2: the preview kept as the first directory’s strip is found, in either byte order', async () => {
  for (const little of [true, false]) await sameBytes(await extractRawPreview(tiff([[0x0111, 30_000], [0x0117, jpeg.length]], 30_000, little)));
});

test('Fujifilm RAF: the preview named in the header is found', async () => {
  const head = new Uint8Array(100);
  new TextEncoder().encodeInto('FUJIFILMCCD-RAW ', head);
  const view = new DataView(head.buffer);
  view.setUint32(84, 4096);
  view.setUint32(88, jpeg.length);
  await sameBytes(await extractRawPreview(new Blob([head, new Uint8Array(4096 - 100), jpeg, new Uint8Array(64)])));
});

test('Canon CR3 and other containers: a JPEG stored inside is found by looking for it', async () => {
  const box = new Uint8Array(24);
  new DataView(box.buffer).setUint32(0, 24);
  new TextEncoder().encodeInto('ftypcrx ', box.subarray(4));
  await sameBytes(await extractRawPreview(new Blob([box, new Uint8Array(100_000), jpeg, new Uint8Array(2048)])));
});

test('a RAW with no usable preview, or a tiny thumbnail only, gives nothing rather than a fake', async () => {
  assert.equal(await extractRawPreview(new Blob([new Uint8Array(50_000)])), null);
  assert.equal(await extractRawPreview(new Blob([tiff([[0x0201, 9_000], [0x0202, 40]], 9_000).slice(0, 100)])), null);
});

test('the supported RAW makers are recognised by file name only, with their label and pickers', () => {
  for (const name of ['A.NEF', 'a.nrw', 'a.ARW', 'a.srf', 'a.sr2', 'a.CR2', 'a.cr3', 'a.RAF', 'a.rw2', 'a.orf', 'a.pef', 'a.dng']) assert.equal(isRawPreviewFile(name), true, name);
  for (const name of ['a.jpg', 'a.cr3.exe', 'cr3', 'a.mov', 'a.nef.jpg']) assert.equal(isRawPreviewFile(name), false, name);
  assert.equal(rawFormatOf('IMG_0001.CR3')?.brand, 'Canon');
  assert.equal(rawFormatOf('DSC00001.ARW')?.brand, 'Sony');
  assert.equal(rawPreviewLabel('IMG_0001.CR3'), 'CR3 Embedded Preview');
  assert.match(PHOTO_ACCEPT, /\.cr3/);
  assert.match(PHOTO_ACCEPT, /\.arw/);
});

test('RAW preview rejects a fabricated JPEG SOF with missing component descriptors', async () => {
  // Build a self-contained synthetic JPEG marker stream. Its SOF advertises
  // plausible 1200x800 pixels but has no component descriptors.
  const bytes = new Uint8Array(5000);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x08, 0x08, 0x03, 0x20, 0x04, 0xb0, 0x03], 0);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  const file = tiff([[0x0201, 4096], [0x0202, bytes.length]], 4096);
  // Replace the nominated preview with the malformed JPEG, without using a camera file.
  const raw = new Blob([file.slice(0, 4096), bytes]);
  assert.equal(await extractRawPreview(raw), null);
});

test('RAW preview rejects JPEG SOF component tables with surplus declared bytes', async () => {
  // JPEG SOF length must be exactly 8 + 3 bytes per component. A padded
  // segment is not a valid component table, even with plausible dimensions.
  const bytes = new Uint8Array(5000);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0e, 0x08, 0x03, 0x20, 0x04, 0xb0, 0x01, 0x01, 0x11, 0x00, 0x00], 0);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  const file = tiff([[0x0201, 4096], [0x0202, bytes.length]], 4096);
  assert.equal(await extractRawPreview(new Blob([file.slice(0, 4096), bytes])), null);
});

test('RAW preview rejects SOF component counts outside the JPEG range', async () => {
  for (const components of [0, 5]) {
    const length = 8 + 3 * components;
    const bytes = new Uint8Array(5000);
    bytes.set([0xff, 0xd8, 0xff, 0xc0, length >> 8, length & 0xff, 0x08, 0x03, 0x20, 0x04, 0xb0, components], 0);
    bytes.set([0xff, 0xd9], bytes.length - 2);
    const file = tiff([[0x0201, 4096], [0x0202, bytes.length]], 4096);
    assert.equal(await extractRawPreview(new Blob([file.slice(0, 4096), bytes])), null, `components=${components}`);
  }
});

test('RAW preview rejects a JPEG claiming multi-gigapixel dimensions before bitmap decode', async () => {
  // Valid SOF0 component table but impossible 65,535 x 65,535 allocation.
  const bytes = new Uint8Array(5000);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0xff, 0xff, 0xff, 0xff, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00], 0);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  const file = tiff([[0x0201, 4096], [0x0202, bytes.length]], 4096);
  assert.equal(await extractRawPreview(new Blob([file.slice(0, 4096), bytes])), null);
});

test('RAW preview accepts a plausible 45 MP SOF header within the pixel safety bound', async () => {
  const bytes = new Uint8Array(5000);
  // Synthetic dimensions similar to a Z8 image (8256 x 5504), not an official camera JPEG.
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x15, 0x80, 0x20, 0x40, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00], 0);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  const file = tiff([[0x0201, 4096], [0x0202, bytes.length]], 4096);
  const result = await extractRawPreview(new Blob([file.slice(0, 4096), bytes]));
  assert.equal(result?.size, bytes.length);
});
