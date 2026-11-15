import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractNefPreview } from './nefPreview';

const jpeg = new Uint8Array(await readFile(new URL('../assets/images/demo_red_kite_flight_1794721996053.jpg', import.meta.url)));
const offset = 15 * 1024 * 1024;
function container(little: boolean, start = offset) {
  const header = new Uint8Array(64);
  const view = new DataView(header.buffer);
  view.setUint16(0, little ? 0x4949 : 0x4d4d);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, 1, little);
  view.setUint16(10, 0x014a, little);
  view.setUint16(12, 4, little);
  view.setUint32(14, 1, little);
  view.setUint32(18, 26, little);
  view.setUint16(26, 2, little);
  for (const [i, tag, value] of [[28, 0x0201, start], [40, 0x0202, jpeg.length]]) {
    view.setUint16(i, tag, little);
    view.setUint16(i + 2, 4, little);
    view.setUint32(i + 4, 1, little);
    view.setUint32(i + 8, value, little);
  }
  view.setUint32(52, 8, little); // cyclic next-directory link
  return header;
}

for (const little of [true, false]) {
  test(`follows a ${little ? 'little' : 'big'}-endian SubIFD to an embedded preview after 14 MiB`, async () => {
    const header = container(little);
    const file = new Blob([header, new Uint8Array(offset - header.length), jpeg]);
    const preview = await extractNefPreview(file);
    assert.equal(preview?.type, 'image/jpeg');
    assert.deepEqual(new Uint8Array(await preview!.arrayBuffer()), jpeg);
  });
}

test('invalid offsets fall back to early embedded JPEGs and truncated files fail safely', async () => {
  const header = container(true, 0xfffffff0);
  assert.equal((await extractNefPreview(new Blob([header, jpeg])))?.size, jpeg.length);
  assert.equal(await extractNefPreview(new Blob([header])), null);
});

test('rejects a fake JPEG marker stream without image dimensions', async () => {
  const fake = new Uint8Array(6000);
  fake.set([0xff, 0xd8, 0xff, 0xe0, 0, 2], 100);
  fake.set([0xff, 0xd9], 5598);
  const file = new Blob([container(true, 0xfffffff0), fake]);
  assert.equal(await extractNefPreview(file), null);
});

test('does not return a malformed TIFF-located preview', async () => {
  const fake = new Uint8Array(Math.max(4096, jpeg.length));
  fake.set([0xff, 0xd8, 0xff, 0xe0, 0, 2]);
  fake.set([0xff, 0xd9], fake.length - 2);
  const header = container(true, 64);
  new DataView(header.buffer).setUint32(48, fake.length, true);
  assert.equal(await extractNefPreview(new Blob([header, fake])), null);
});

test('tries the next TIFF preview when the largest candidate is malformed', async () => {
  const malformed = new Uint8Array(jpeg.length + 1);
  malformed.set([0xff, 0xd8, 0xff, 0xe0, 0, 2]);
  malformed.set([0xff, 0xd9], malformed.length - 2);
  const header = container(true);
  const view = new DataView(header.buffer);
  view.setUint32(48, malformed.length, true);
  view.setUint32(52, header.length, true);
  const secondDirectory = container(true, offset + malformed.length).slice(26, 56);
  const file = new Blob([
    header,
    secondDirectory,
    new Uint8Array(offset - header.length - secondDirectory.length),
    malformed,
    jpeg,
  ]);

  const preview = await extractNefPreview(file);
  assert.ok(preview);
  assert.deepEqual(new Uint8Array(await preview.arrayBuffer()), jpeg);
});

test('NEF preview requires plausible width and height, not just one large dimension', async () => {
  function preview(width: number, height: number) {
    const bytes = new Uint8Array(5000);
    const view = new DataView(bytes.buffer);
    bytes.set([0xff, 0xd8, 0xff, 0xc0], 0);
    view.setUint16(4, 17); // SOF0 length
    bytes[6] = 8; // precision
    view.setUint16(7, height);
    view.setUint16(9, width);
    bytes.set([0xff, 0xd9], bytes.length - 2);
    return bytes;
  }
  const header = container(true, 64);
  new DataView(header.buffer).setUint32(48, 5000, true);
  assert.equal(await extractNefPreview(new Blob([header, preview(8256, 1)])), null);
  assert.equal(await extractNefPreview(new Blob([header, preview(1, 5504)])), null);
  assert.equal((await extractNefPreview(new Blob([header, preview(8256, 5504)])))?.size, 5000);
  assert.equal((await extractNefPreview(new Blob([header, preview(640, 480)])))?.size, 5000);
});

test('rejects a truncated JPEG SOF segment even when width and height look valid', async () => {
  const bytes = new Uint8Array(5000);
  const view = new DataView(bytes.buffer);
  bytes.set([0xff, 0xd8, 0xff, 0xc0], 0);
  view.setUint16(4, 6000); // Claims more SOF bytes than the entire preview contains.
  bytes[6] = 8;
  view.setUint16(7, 5504);
  view.setUint16(9, 8256);
  bytes.set([0xff, 0xd9], bytes.length - 2);
  const header = container(true, 64);
  new DataView(header.buffer).setUint32(48, bytes.length, true);
  assert.equal(await extractNefPreview(new Blob([header, bytes])), null);
});


test('prefers more pixels over a larger compressed byte count', async () => {
  function preview(width: number, height: number, length: number) {
    const bytes = new Uint8Array(length);
    bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8]);
    const view = new DataView(bytes.buffer);
    view.setUint16(7, height);
    view.setUint16(9, width);
    bytes.set([0xff, 0xd9], length - 2);
    return bytes;
  }

  const lowerResolution = preview(640, 480, 12000);
  const higherResolution = preview(2048, 1365, 6000);
  const header = container(true, 94);
  const view = new DataView(header.buffer);
  view.setUint32(48, lowerResolution.length, true);
  view.setUint32(52, 64, true);
  const secondDirectory = container(true, 94 + lowerResolution.length).slice(26, 56);
  new DataView(secondDirectory.buffer).setUint32(22, higherResolution.length, true);
  new DataView(secondDirectory.buffer).setUint32(26, 0, true);

  const result = await extractNefPreview(new Blob([header, secondDirectory, lowerResolution, higherResolution]));
  assert.ok(result);
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), higherResolution);
});

test('follows a Nikon-style EXIF IFD to a full preview beyond the bounded fallback scan', async () => {
  const at = 30 * 1024 * 1024;
  const header = new Uint8Array(64);
  const view = new DataView(header.buffer);
  view.setUint16(0, 0x4949);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8769, true); // ExifIFDPointer
  view.setUint16(12, 4, true); // LONG
  view.setUint32(14, 1, true);
  view.setUint32(18, 32, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 0x0201, true);
  view.setUint16(36, 4, true);
  view.setUint32(38, 1, true);
  view.setUint32(42, at, true);
  view.setUint16(46, 0x0202, true);
  view.setUint16(48, 4, true);
  view.setUint32(50, 1, true);
  view.setUint32(54, jpeg.length, true);
  const raw = new Blob([header, new Uint8Array(at - header.length), jpeg]);
  const preview = await extractNefPreview(raw);
  assert.ok(preview);
  assert.deepEqual(new Uint8Array(await preview.arrayBuffer()), jpeg);
});

test('invalid EXIF IFD pointers do not prevent a safe null result', async () => {
  const header = new Uint8Array(32);
  const view = new DataView(header.buffer);
  view.setUint16(0, 0x4949);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0x8769, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, 0xfffffff0, true);
  assert.equal(await extractNefPreview(new Blob([header])), null);
});
