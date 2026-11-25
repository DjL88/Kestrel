import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractNefPreview, extractRawPreview, orientPreview, rawOrientation } from './nefPreview';

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
    // Three well-formed JPEG SOF component descriptors after dimensions.
    bytes.set([3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0], 11);
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
    bytes.set([3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0], 11);
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

test('progressive fallback scans in bounded windows instead of reading 28 MiB immediately', async () => {
  // An invalid TIFF header forces fallback without relying on a real camera RAW.
  const raw = new Blob([new Uint8Array(30 * 1024 * 1024)]);
  const lengths: number[] = [];
  const originalSlice = raw.slice.bind(raw);
  raw.slice = ((start?: number, end?: number, contentType?: string) => {
    if (start === 0 && end && end >= 1024 * 1024) lengths.push(end);
    return originalSlice(start, end, contentType);
  }) as Blob['slice'];
  assert.equal(await extractNefPreview(raw), null);
  assert.deepEqual(lengths, [4, 12, 28].map((size) => size * 1024 * 1024));
});

test('small RAW files do not request a fallback slice larger than the file', async () => {
  const raw = new Blob([new Uint8Array(1024)]);
  const ends: number[] = [];
  const originalSlice = raw.slice.bind(raw);
  raw.slice = ((start?: number, end?: number, contentType?: string) => {
    if (start === 0 && end && end >= 1024) ends.push(end);
    return originalSlice(start, end, contentType);
  }) as Blob['slice'];
  assert.equal(await extractNefPreview(raw), null);
  assert.ok(ends.every((end) => end <= raw.size));
});

/** A TIFF-style RAW whose first directory records the camera's Orientation and points at a landscape embedded JPEG. */
function orientedRaw(orientation: number | null, preview: Uint8Array<ArrayBuffer> = jpeg, little = true): Blob {
  const at = 4096;
  const header = new Uint8Array(at);
  const view = new DataView(header.buffer);
  const entries: [number, number, number][] = [[0x0201, 4, at], [0x0202, 4, preview.length]];
  if (orientation !== null) entries.unshift([0x0112, 3, orientation]);
  view.setUint16(0, little ? 0x4949 : 0x4d4d);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  view.setUint16(8, entries.length, little);
  entries.forEach(([tag, type, value], i) => {
    const entry = 10 + i * 12;
    view.setUint16(entry, tag, little);
    view.setUint16(entry + 2, type, little);
    view.setUint32(entry + 4, 1, little);
    if (type === 3) view.setUint16(entry + 8, value, little); else view.setUint32(entry + 8, value, little);
  });
  view.setUint32(10 + entries.length * 12, 0, little);
  return new Blob([header, preview]);
}

/** The Orientation in a JPEG's Exif APP1, as a browser reads it; null when it has none. */
function previewOrientation(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff && bytes[offset + 1] !== 0xda) {
    const length = view.getUint16(offset + 2);
    if (bytes[offset + 1] === 0xe1 && String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'Exif') {
      const tiff = offset + 10, little = view.getUint16(tiff) === 0x4949;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      for (let i = 0; i < view.getUint16(ifd, little); i += 1) {
        const entry = ifd + 2 + i * 12;
        if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
      }
    }
    offset += 2 + length;
  }
  return null;
}

/** The JPEG without the one Exif segment orientPreview adds, to prove the picture data is untouched. */
function withoutAddedSegment(bytes: Uint8Array): Uint8Array {
  let offset = 2;
  while (bytes[offset + 1] === 0xe0) offset += 2 + ((bytes[offset + 2] << 8) | bytes[offset + 3]);
  assert.deepEqual([bytes[offset], bytes[offset + 1]], [0xff, 0xe1]);
  return Uint8Array.from([...bytes.subarray(0, offset), ...bytes.subarray(offset + 36)]);
}

for (const orientation of [6, 8]) for (const little of [true, false]) {
  test(`a portrait RAW (Orientation ${orientation}, ${little ? 'little' : 'big'}-endian) gives its sideways preview the same turn`, async () => {
    const preview = await extractRawPreview(orientedRaw(orientation, jpeg, little));
    assert.ok(preview);
    const bytes = new Uint8Array(await preview.arrayBuffer());
    assert.equal(preview.type, 'image/jpeg');
    assert.equal(previewOrientation(bytes), orientation, 'browsers, createImageBitmap and thumbnails then show it upright');
    assert.deepEqual(withoutAddedSegment(bytes), jpeg, 'the preview pixels are not re-encoded');
  });
}

test('the RAW Orientation is read from its first directory, and only values 1 to 8 count', async () => {
  assert.equal(await rawOrientation(orientedRaw(6)), 6);
  assert.equal(await rawOrientation(orientedRaw(8, jpeg, false)), 8);
  assert.equal(await rawOrientation(orientedRaw(null)), null);
  assert.equal(await rawOrientation(orientedRaw(9)), null);
  assert.equal(await rawOrientation(new Blob([jpeg])), null);
});

test('an upright RAW, or one with no Orientation, keeps its preview byte for byte', async () => {
  for (const orientation of [1, null, 9]) {
    const preview = await extractRawPreview(orientedRaw(orientation));
    assert.deepEqual(new Uint8Array(await preview!.arrayBuffer()), jpeg, `orientation ${orientation}`);
  }
});

test('a preview with its own Orientation, or one already turned to portrait, is not turned twice', async () => {
  const tagged = new Uint8Array(await (await orientPreview(new Blob([jpeg]), 3)).arrayBuffer());
  assert.equal(previewOrientation(tagged), 3);
  const again = await extractRawPreview(orientedRaw(6, tagged));
  assert.equal(previewOrientation(new Uint8Array(await again!.arrayBuffer())), 3, 'the preview\'s own tag wins');

  // The same JPEG with its frame header claiming portrait (848 wide, 1264 high): the camera already turned it.
  const portrait = jpeg.slice();
  for (let offset = 2; offset < portrait.length;) {
    const marker = portrait[offset + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const view = new DataView(portrait.buffer);
      const height = view.getUint16(offset + 5), width = view.getUint16(offset + 7);
      view.setUint16(offset + 5, width); view.setUint16(offset + 7, height);
      break;
    }
    offset += 2 + ((portrait[offset + 2] << 8) | portrait[offset + 3]);
  }
  const turned = await extractRawPreview(orientedRaw(6, portrait));
  assert.deepEqual(new Uint8Array(await turned!.arrayBuffer()), portrait);
});
