import type { CaptureStamp } from './types';

/**
 * The EXIF dates an export carries. DateTime (0x0132) is when the export was made, in UTC. The capture dates
 * (DateTimeOriginal 0x9003, DateTimeDigitized 0x9004 and their offsets) are copied from the original's own EXIF and
 * are left out when it has none: an export never claims a photo was taken when it was exported.
 */
export function exifDateBlock(date: Date, capture?: CaptureStamp) {
  const exportTime = date.toISOString().slice(0, 19).replace(/-/g, ':').replace('T', ' ');
  const ascii = (tag: number, text?: string) => (text ? [{ tag, value: new TextEncoder().encode(`${text}\0`) }] : []);
  const exifTags = [
    ...ascii(0x9003, capture?.original),
    ...ascii(0x9004, capture?.digitized),
    ...ascii(0x9010, '+00:00'),
    ...ascii(0x9011, capture?.original ? capture.offsetOriginal : undefined),
    ...ascii(0x9012, capture?.digitized ? capture.offsetDigitized : undefined),
  ];
  const ifd0At = 8, ifd0Size = 2 + 2 * 12 + 4;
  const exifAt = ifd0At + ifd0Size, exifSize = 2 + exifTags.length * 12 + 4;
  const values = [{ tag: 0x0132, value: new TextEncoder().encode(`${exportTime}\0`) }, ...exifTags];
  const total = exifAt + exifSize + values.reduce((sum, entry) => sum + entry.value.length, 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  const writeTag = (offset: number, tag: number, type: number, count: number, value: number) => {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true);
    view.setUint32(offset + 8, value, true);
  };
  bytes.set([0x49, 0x49, 42, 0, ifd0At, 0, 0, 0]);
  let data = exifAt + exifSize;
  const place = (value: Uint8Array) => { const at = data; bytes.set(value, at); data += value.length; return at; };
  view.setUint16(ifd0At, 2, true);
  writeTag(ifd0At + 2, 0x0132, 2, values[0].value.length, place(values[0].value));
  writeTag(ifd0At + 14, 0x8769, 4, 1, exifAt);
  view.setUint16(exifAt, exifTags.length, true);
  exifTags.forEach((entry, i) => writeTag(exifAt + 2 + i * 12, entry.tag, 2, entry.value.length, place(entry.value)));
  return bytes;
}

function pngExifChunk(tiff: Uint8Array) {
  const bytes = new Uint8Array(tiff.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, tiff.length);
  bytes.set(new TextEncoder().encode('eXIf'), 4);
  bytes.set(tiff, 8);
  let crc = -1;
  for (const byte of bytes.subarray(4, bytes.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(bytes.length - 4, ~crc);
  return bytes;
}

/** The encoded export with its EXIF dates: `date` as the export time, `capture` as the original's own capture dates. */
export function datedExport(blob: Blob, name: string, date: Date, capture?: CaptureStamp): File {
  const tiff = exifDateBlock(date, capture);
  if (blob.type === 'image/png') {
    return new File([blob.slice(0, 33), pngExifChunk(tiff), blob.slice(33)], name,
      { type: blob.type, lastModified: date.getTime() });
  }
  const length = tiff.length + 8;
  const app1 = new Uint8Array([0xff, 0xe1, length >> 8, length & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  return new File([blob.slice(0, 2), app1, tiff, blob.slice(2)], name,
    { type: blob.type, lastModified: date.getTime() });
}
