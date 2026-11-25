import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SRGB_ICC_PROFILE, iccDescription, readColourTag, tagSrgb } from './iccEmbed';
import { encodePng16, provePng } from './png16';
import { encodeTiff16 } from './master16';

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/** A browser-shaped JPEG header: SOI, JFIF APP0, a quantisation table, then start of scan and end. No colour tag. */
function bareJpeg(withExif = false): Uint8Array<ArrayBuffer> {
  const app0 = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const app1 = withExif ? [0xff, 0xe1, 0, 8, 0x45, 0x78, 0x69, 0x66, 0, 0] : [];
  const dqt = [0xff, 0xdb, 0, 4, 0, 1];
  const sos = [0xff, 0xda, 0, 2, 0x12, 0x34, 0x56];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...app1, ...dqt, ...sos, 0xff, 0xd9]);
}

/** A minimal 8-bit PNG with IHDR, one IDAT and IEND and no colour chunk, as a canvas toBlob writes. */
async function barePng(): Promise<Uint8Array<ArrayBuffer>> {
  // encodePng16 writes sRGB after IHDR; remove that chunk to get an untagged PNG of the same shape.
  const tagged = await bytesOf(await encodePng16({ width: 2, height: 1, data: new Uint16Array(6) }));
  assert.equal(String.fromCharCode(...tagged.subarray(37, 41)), 'sRGB');
  return Uint8Array.from([...tagged.subarray(0, 33), ...tagged.subarray(33 + 13)]);
}

test('the sRGB profile is a valid ICC profile that names itself sRGB', () => {
  const view = new DataView(SRGB_ICC_PROFILE.buffer);
  assert.equal(view.getUint32(0), SRGB_ICC_PROFILE.length, 'declared size matches');
  assert.equal(String.fromCharCode(...SRGB_ICC_PROFILE.subarray(36, 40)), 'acsp');
  assert.equal(String.fromCharCode(...SRGB_ICC_PROFILE.subarray(16, 20)), 'RGB ');
  assert.match(iccDescription(SRGB_ICC_PROFILE) ?? '', /sRGB/);
});

test('an untagged JPEG gets the sRGB profile after JFIF, and nothing else changes', async () => {
  const bare = bareJpeg();
  assert.deepEqual(readColourTag(bare), { kind: 'none' });
  const out = await bytesOf(await tagSrgb(new Blob([bare], { type: 'image/jpeg' }), 'jpeg'));
  const tag = readColourTag(out);
  assert.equal(tag.kind, 'icc');
  assert.deepEqual(tag.kind === 'icc' && [...tag.profile], [...SRGB_ICC_PROFILE]);
  assert.match((tag.kind === 'icc' && tag.description) || '', /sRGB/);
  // APP0 stays first (some readers require JFIF straight after SOI), then APP2.
  assert.deepEqual([out[20], out[21]], [0xff, 0xe2]);
  // Everything else is the original bytes, untouched.
  const segment = 2 + ((out[22] << 8) | out[23]);
  assert.deepEqual([...out.subarray(0, 20), ...out.subarray(20 + segment)], [...bare]);
});

test('the JPEG profile goes after an Exif APP1 too', async () => {
  const out = await bytesOf(await tagSrgb(new Blob([bareJpeg(true)]), 'jpeg'));
  assert.deepEqual([out[20], out[21]], [0xff, 0xe1]);
  assert.deepEqual([out[30], out[31]], [0xff, 0xe2]);
});

test('a JPEG that already has a profile is returned exactly as it was', async () => {
  const once = await tagSrgb(new Blob([bareJpeg()]), 'jpeg');
  const twice = await tagSrgb(once, 'jpeg');
  assert.equal(twice, once);
});

test('an untagged PNG gets the sRGB chunk straight after IHDR, with a valid CRC', async () => {
  const bare = await barePng();
  assert.deepEqual(readColourTag(bare), { kind: 'none' });
  const out = await bytesOf(await tagSrgb(new Blob([bare], { type: 'image/png' }), 'png'));
  assert.deepEqual(readColourTag(out), { kind: 'srgb-chunk' });
  const proof = provePng(out); // checks every chunk's CRC
  assert.equal(proof.srgb, true);
  assert.equal(out.length, bare.length + 13);
});

test('a PNG that is already tagged is returned exactly as it was', async () => {
  const tagged = await encodePng16({ width: 2, height: 1, data: new Uint16Array(6) });
  assert.equal(await tagSrgb(tagged, 'png'), tagged);
});

test('the 16-bit TIFF still carries the same sRGB profile', async () => {
  const tiff = await bytesOf(encodeTiff16({ width: 1, height: 1, data: new Uint16Array(3) }));
  const text = Buffer.from(tiff).indexOf(Buffer.from(SRGB_ICC_PROFILE));
  assert.ok(text > 0);
});

test('a file that is not a JPEG or PNG is refused in plain words', async () => {
  await assert.rejects(tagSrgb(new Blob([Uint8Array.of(1, 2, 3, 4)]), 'jpeg'), /JPEG is invalid/);
  await assert.rejects(tagSrgb(new Blob([Uint8Array.of(1, 2, 3, 4)]), 'png'), /PNG is invalid/);
});
