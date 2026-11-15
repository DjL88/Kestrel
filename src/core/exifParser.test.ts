import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractEmbeddedJpegFromRawBuffer,
  formatAperture,
  formatCameraLabel,
  formatFocalLength,
  formatShutterSpeed,
  isNikonEmbeddedPreviewFile,
  validExifPositiveNumber,
  validExifDimension,
  validExifCaptureTimestamp,
} from './exifParser';

test('EXIF formatting returns blank strings when values are missing', () => {
  assert.equal(formatShutterSpeed(undefined), '');
  assert.equal(formatAperture(undefined), '');
  assert.equal(formatFocalLength(undefined), '');
  assert.equal(formatCameraLabel(undefined, undefined), undefined);
});

test('EXIF formatting formats Nikon settings accurately', () => {
  assert.equal(formatShutterSpeed(1 / 2500), '1/2500s');
  assert.equal(formatShutterSpeed(0.5), '0.5s');
  assert.equal(formatAperture(5.6), 'f/5.6');
  assert.equal(formatAperture(4), 'f/4');
  assert.equal(formatFocalLength(600), '600mm');
  assert.equal(formatCameraLabel('NIKON CORPORATION', 'NIKON Z 8'), 'NIKON Z 8');
  assert.equal(formatCameraLabel('Nikon', 'Z 5II'), 'Nikon Z 5II');
});

test('extractEmbeddedJpegFromRawBuffer finds largest embedded JPEG preview stream', () => {
  const bytes = new Uint8Array(6000);
  // Fake NEF header bytes
  bytes[0] = 0x4d;
  bytes[1] = 0x4d;
  // Embedded preview JPEG starting at offset 100, length 5000 (> 4096 threshold)
  bytes[100] = 0xff;
  bytes[101] = 0xd8;
  bytes[102] = 0xff;
  bytes[5098] = 0xff;
  bytes[5099] = 0xd9;

  const extracted = extractEmbeddedJpegFromRawBuffer(bytes.buffer);
  assert.ok(extracted !== null);
  assert.equal(extracted.isEmbeddedPreviewOnly, true);
  assert.equal(extracted.bytes.length, 5000);
  assert.equal(extracted.bytes[0], 0xff);
  assert.equal(extracted.bytes[1], 0xd8);
});

test('embedded XMP ratings and reject flags are parsed from a JPEG segment', async () => {
  const { parseImageExif } = await import('./exifParser');
  function jpeg(rating: number): Blob {
    const xml = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
      `<rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="${rating}"/></rdf:RDF></x:xmpmeta>`;
    const packet = Buffer.from('http://ns.adobe.com/xap/1.0/\0' + xml);
    const segmentSize = packet.length + 2;
    const bytes = Buffer.concat([Buffer.from([255, 216, 255, 225, segmentSize >> 8, segmentSize & 255]), packet, Buffer.from([255, 217])]);
    // exifr uses a byte reader in Node instead of the browser Blob reader.
    return bytes as unknown as Blob;
  }
  assert.equal((await parseImageExif(jpeg(4), 'rating.jpg')).rating, 4);
  const rejected = await parseImageExif(jpeg(-1), 'rejected.jpg');
  assert.equal(rejected.rating, undefined);
  assert.equal(rejected.rejectedByMetadata, true);
});

test('Nikon NEF and NRW filenames share the embedded-preview route', () => {
  assert.equal(isNikonEmbeddedPreviewFile('Z8_0001.NEF'), true);
  assert.equal(isNikonEmbeddedPreviewFile('COOLPIX_0001.nrw'), true);
  assert.equal(isNikonEmbeddedPreviewFile('photo.nef.jpg'), false);
  assert.equal(isNikonEmbeddedPreviewFile('photo.jpg'), false);
  assert.equal(isNikonEmbeddedPreviewFile('photo.dng'), false);
});

test('NRW metadata never claims full RAW decoding, including parse failure', async () => {
  const { parseImageExif } = await import('./exifParser');
  const metadata = await parseImageExif(new Blob([new Uint8Array(8)]), 'NIKON.NRW');
  assert.equal(metadata.formatLabel, 'NRW Embedded Preview');
  assert.equal(metadata.isEmbeddedPreviewOnly, true);
});

test('rejects corrupt numeric EXIF values instead of displaying impossible camera settings', () => {
  for (const invalid of [NaN, Infinity, -Infinity, 0, -1, '8256', null, undefined]) {
    assert.equal(validExifPositiveNumber(invalid), undefined);
    assert.equal(validExifDimension(invalid), undefined);
  }
  assert.equal(validExifPositiveNumber(5.6), 5.6);
  assert.equal(validExifPositiveNumber(8256), 8256);
  assert.equal(validExifDimension(8256), 8256);
  assert.equal(validExifDimension(5504), 5504);
  assert.equal(validExifDimension(8256.5), undefined);
  assert.equal(validExifDimension(Number.MAX_SAFE_INTEGER + 1), undefined);
  assert.equal(formatFocalLength(Infinity), '');
});


test('malformed camera make/model values do not crash EXIF formatting', () => {
  assert.equal(formatCameraLabel({ invalid: true }, 'NIKON Z 8'), 'NIKON Z 8');
  assert.equal(formatCameraLabel('NIKON CORPORATION', ['Z 5II']), 'NIKON CORPORATION');
  assert.equal(formatCameraLabel(123, null), undefined);
  assert.equal(formatCameraLabel('  Nikon  ', '  Z 5II  '), 'Nikon Z 5II');
});

test('Nikon camera identity ignores TIFF NUL terminators and control bytes', () => {
  assert.equal(formatCameraLabel('NIKON CORPORATION\0', 'NIKON Z 8\0'), 'NIKON Z 8');
  assert.equal(formatCameraLabel('Nikon\t', 'Z 5II\n'), 'Nikon Z 5II');
  assert.equal(formatCameraLabel('\0\n', '\0'), undefined);
});

test('capture timestamp falls back when DateTimeOriginal is malformed', () => {
  const original = new Date('2026-11-15T10:00:00Z');
  const created = new Date('2026-11-15T10:01:00Z');
  assert.equal(validExifCaptureTimestamp(original, created), original.getTime());
  assert.equal(validExifCaptureTimestamp(new Date(NaN), created), created.getTime());
  assert.equal(validExifCaptureTimestamp('invalid', created), created.getTime());
  assert.equal(validExifCaptureTimestamp(undefined, created), created.getTime());
  assert.equal(validExifCaptureTimestamp(new Date(NaN), 'invalid'), undefined);
});
