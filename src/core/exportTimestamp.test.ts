import test from 'node:test';
import assert from 'node:assert/strict';
import exifr from 'exifr';
import { datedExport } from './exportTimestamp';
import { parseImageExif, readCaptureStamp } from './exifParser';

/**
 * G07/G09: an export says when it was exported (DateTime) and keeps the camera's own capture dates. It never writes the
 * export time as the capture time, and never invents a capture time the original does not have. Synthetic files only.
 */

type Entry = { tag: number; text: string };

/** A little-endian TIFF with Make/Model in IFD0 and the given ASCII tags in its Exif IFD, shaped like a NEF's header. */
function tiff(exifEntries: Entry[]): Uint8Array {
  const ifd0: Entry[] = [{ tag: 0x010f, text: 'NIKON CORPORATION' }, { tag: 0x0110, text: 'NIKON Z 8' }];
  const ifd0At = 8, ifd0Size = 2 + (ifd0.length + 1) * 12 + 4;
  const exifAt = ifd0At + ifd0Size, exifSize = 2 + exifEntries.length * 12 + 4;
  const strings = [...ifd0, ...exifEntries].map((entry) => new TextEncoder().encode(`${entry.text}\0`));
  const bytes = new Uint8Array(exifAt + exifSize + strings.reduce((sum, s) => sum + s.length, 0) + 64);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49, 42, 0, ifd0At, 0, 0, 0]);
  let data = exifAt + exifSize;
  const put = (at: number, tag: number, type: number, count: number, value: number) => {
    view.setUint16(at, tag, true); view.setUint16(at + 2, type, true); view.setUint32(at + 4, count, true); view.setUint32(at + 8, value, true);
  };
  const ascii = (at: number, entry: Entry, i: number) => { bytes.set(strings[i], data); put(at, entry.tag, 2, strings[i].length, data); data += strings[i].length; };
  view.setUint16(ifd0At, ifd0.length + 1, true);
  ifd0.forEach((entry, i) => ascii(ifd0At + 2 + i * 12, entry, i));
  put(ifd0At + 2 + ifd0.length * 12, 0x8769, 4, 1, exifAt);
  view.setUint16(exifAt, exifEntries.length, true);
  exifEntries.forEach((entry, i) => ascii(exifAt + 2 + i * 12, entry, ifd0.length + i));
  return bytes;
}

/** A JPEG carrying that TIFF as its Exif block. */
function jpegWith(exif: Uint8Array): Uint8Array {
  const length = exif.length + 8;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 255, 0x45, 0x78, 0x69, 0x66, 0, 0, ...exif, 0xff, 0xd9]);
}

const CAMERA: Entry[] = [
  { tag: 0x9003, text: '2025:06:14 05:42:10' },
  { tag: 0x9004, text: '2025:06:14 05:42:11' },
  { tag: 0x9011, text: '+01:00' },
  { tag: 0x9012, text: '+01:00' },
];
/**
 * The file as parseImageExif reads it in Node: exifr reads a Buffer (it has no FileReader here), and the RAW size probe
 * slices it as a Blob.
 */
function asFile(bytes: Uint8Array): Blob {
  const buffer = Buffer.from(bytes);
  const blob = new Blob([new Uint8Array(bytes)]);
  return Object.assign(buffer, { slice: (start?: number, end?: number) => blob.slice(start, end) }) as unknown as Blob;
}

const EXPORTED = new Date('2026-11-25T14:03:09Z');
const encoded = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

async function datesIn(file: File) {
  const parsed = await exifr.parse(Buffer.from(await file.arrayBuffer()), { reviveValues: false, mergeOutput: false });
  return { ...parsed?.ifd0, ...parsed?.exif } as Record<string, unknown>;
}

test('an export from a NEF keeps the camera capture dates and stamps only DateTime with the export time', async () => {
  const exif = await parseImageExif(asFile(tiff(CAMERA)), 'Z8_0001.NEF');
  assert.deepEqual(exif.captureStamp, { original: '2025:06:14 05:42:10', digitized: '2025:06:14 05:42:11', offsetOriginal: '+01:00', offsetDigitized: '+01:00' });
  const dates = await datesIn(datedExport(encoded(), 'Z8_0001-preview.jpg', EXPORTED, exif.captureStamp));
  assert.equal(dates.ModifyDate, '2026:11:25 14:03:09', 'DateTime is the export time');
  assert.equal(dates.OffsetTime, '+00:00');
  assert.equal(dates.DateTimeOriginal, '2025:06:14 05:42:10', 'capture time is the camera’s');
  assert.equal(dates.CreateDate, '2025:06:14 05:42:11');
  assert.equal(dates.OffsetTimeOriginal, '+01:00');
  assert.equal(dates.OffsetTimeDigitized, '+01:00');
});

test('an export from a JPEG keeps its capture dates, as JPEG and as PNG', async () => {
  const exif = await parseImageExif(asFile(jpegWith(tiff(CAMERA.slice(0, 1)))), 'IMG_0001.jpg');
  assert.deepEqual(exif.captureStamp, { original: '2025:06:14 05:42:10' }, 'no digitized date or offset is invented');
  const jpeg = await datesIn(datedExport(encoded(), 'IMG_0001.jpg', EXPORTED, exif.captureStamp));
  assert.equal(jpeg.DateTimeOriginal, '2025:06:14 05:42:10');
  assert.equal(jpeg.ModifyDate, '2026:11:25 14:03:09');
  assert.equal(jpeg.CreateDate, undefined);
  assert.equal(jpeg.OffsetTimeOriginal, undefined);

  // A PNG carries the same block as an eXIf chunk after IHDR.
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0x90, 0x77, 0x53, 0xde, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  const pngFile = datedExport(new Blob([png], { type: 'image/png' }), 'IMG_0001.png', EXPORTED, exif.captureStamp);
  const bytes = Buffer.from(await pngFile.arrayBuffer());
  const at = bytes.indexOf('eXIf');
  assert.equal(at, 37, 'the eXIf chunk follows IHDR');
  const block = bytes.subarray(at + 4, at + 4 + bytes.readUInt32BE(at - 4)).toString('latin1');
  assert.ok(block.includes('2025:06:14 05:42:10') && block.includes('2026:11:25 14:03:09'));
});

test('a photo with no capture date in its file exports with none: never the export time or the file date', async () => {
  const exif = await parseImageExif(asFile(tiff([])), 'Z8_0002.NEF');
  assert.equal(exif.captureStamp, undefined);
  const dates = await datesIn(datedExport(encoded(), 'Z8_0002-preview.jpg', EXPORTED, exif.captureStamp));
  assert.equal(dates.ModifyDate, '2026:11:25 14:03:09');
  for (const tag of ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal', 'OffsetTimeDigitized']) assert.equal(dates[tag], undefined, `${tag} is absent`);
  const bytes = Buffer.from(await datedExport(encoded(), 'x.jpg', EXPORTED).arrayBuffer()).toString('latin1');
  assert.equal(bytes.match(/\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/g)?.length, 1, 'the only date in the export is its export time');
});

test('capture stamps keep only valid dates, and an offset only beside its own date', () => {
  const at = new Date(2025, 5, 14, 5, 42, 10);
  assert.deepEqual(readCaptureStamp(at, undefined, '+01:00', '+02:00'), { original: '2025:06:14 05:42:10', offsetOriginal: '+01:00' });
  assert.deepEqual(readCaptureStamp(undefined, at, ' -05:30 ', 'bad'), { digitized: '2025:06:14 05:42:10' });
  assert.deepEqual(readCaptureStamp(at, at, '+15:00', '-05:30'), { original: '2025:06:14 05:42:10', digitized: '2025:06:14 05:42:10', offsetDigitized: '-05:30' });
  assert.equal(readCaptureStamp(new Date(Number.NaN), '2025:06:14 05:42:10', '+01:00', '+01:00'), undefined);
  assert.equal(readCaptureStamp(undefined, undefined, undefined, undefined), undefined);
});
