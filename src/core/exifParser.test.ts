import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractEmbeddedJpegFromRawBuffer,
  formatAperture,
  formatCameraLabel,
  formatFocalLength,
  formatShutterSpeed,
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
