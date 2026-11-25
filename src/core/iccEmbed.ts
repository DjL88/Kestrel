/**
 * Colour tags for exported pictures, added without a new image encode.
 *
 * A browser canvas works in sRGB, but `toBlob` writes JPEG and PNG files with no colour tag at all, so other apps have to
 * guess. Every V2 export is sRGB pixels, so we say so: an ICC profile in a JPEG APP2 segment, or the standard sRGB chunk
 * in a PNG (the PNG way of saying "this is sRGB"; an iCCP chunk must not sit beside it). A file that already carries a
 * colour tag is left exactly as it is, and the encoded pixels are never touched.
 *
 * This is a truthful *output* tag for sRGB pixels only. Another profile (Display P3, Adobe RGB) may be embedded only after
 * the pixels really were converted to it.
 */

/**
 * Standard sRGB ICC profile generated with LittleCMS (588 bytes, RGB display class, 'acsp' signature). The RAW decoder
 * hands the exporters display-encoded sRGB, so this describes the pixels as they are.
 */
const SRGB_ICC_BASE64 = 'AAACTGxjbXMEQAAAbW50clJHQiBYWVogB+oACwATAA4ADAAeYWNzcEFQUEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1sY21zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALZGVzYwAAAQgAAAA2Y3BydAAAAUAAAABMd3RwdAAAAYwAAAAUY2hhZAAAAaAAAAAsclhZWgAAAcwAAAAUYlhZWgAAAeAAAAAUZ1hZWgAAAfQAAAAUclRSQwAAAggAAAAgZ1RSQwAAAggAAAAgYlRSQwAAAggAAAAgY2hybQAAAigAAAAkbWx1YwAAAAAAAAABAAAADGVuVVMAAAAaAAAAHABzAFIARwBCACAAYgB1AGkAbAB0AC0AaQBuAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAADAAAAAcAE4AbwAgAGMAbwBwAHkAcgBpAGcAaAB0ACwAIAB1AHMAZQAgAGYAcgBlAGUAbAB5WFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDEIAAAXe///zJQAAB5MAAP2Q///7of///aIAAAPcAADAblhZWiAAAAAAAABvoAAAOPUAAAOQWFlaIAAAAAAAACSfAAAPhAAAtsNYWVogAAAAAAAAYpcAALeHAAAY2XBhcmEAAAAAAAMAAAACZmYAAPKnAAANWQAAE9AAAApbY2hybQAAAAAAAwAAAACj1wAAVHsAAEzNAACZmgAAJmYAAA9c';
export const SRGB_ICC_PROFILE: Uint8Array = Uint8Array.from(atob(SRGB_ICC_BASE64), (char) => char.charCodeAt(0));

const ICC_IDENTIFIER = new TextEncoder().encode('ICC_PROFILE\0');
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Longest JPEG header we walk before giving up looking for an existing profile. Browser encoders write a few hundred bytes. */
const JPEG_HEADER_LIMIT = 1 << 20;

/** What colour tag an encoded JPEG or PNG carries. */
export type ColourTag =
  | { kind: 'icc'; profile: Uint8Array; description: string | null }
  | { kind: 'srgb-chunk' }
  | { kind: 'none' };

/** Add the sRGB tag to a browser-encoded JPEG or PNG that has none. Throws, in plain words, on a file that is not valid. */
export async function tagSrgb(raster: Blob, format: 'jpeg' | 'png'): Promise<Blob> {
  if (format === 'jpeg') {
    const header = await jpegHeader(raster);
    if (header.hasIcc) return raster;
    return new Blob([raster.slice(0, header.insertAt), jpegIccSegment(SRGB_ICC_PROFILE), raster.slice(header.insertAt)], { type: 'image/jpeg' });
  }
  const header = await pngHeader(raster);
  if (header.tagged) return raster;
  return new Blob([raster.slice(0, header.afterIhdr), pngChunk('sRGB', Uint8Array.of(0)), raster.slice(header.afterIhdr)], { type: 'image/png' });
}

/** Read the colour tag from encoded JPEG or PNG bytes (used by tests and checks; does not decode pixels). */
export function readColourTag(bytes: Uint8Array): ColourTag {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    const parts: Uint8Array[] = [];
    let at = 2;
    while (at + 4 <= bytes.length && bytes[at] === 0xff) {
      const marker = bytes[at + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const length = (bytes[at + 2] << 8) | bytes[at + 3];
      const body = bytes.subarray(at + 4, at + 2 + length);
      if (marker === 0xe2 && startsWith(body, ICC_IDENTIFIER)) parts.push(body.subarray(ICC_IDENTIFIER.length + 2));
      at += 2 + length;
    }
    if (!parts.length) return { kind: 'none' };
    const profile = concat(parts);
    return { kind: 'icc', profile, description: iccDescription(profile) };
  }
  if (PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
    let at = 8;
    while (at + 8 <= bytes.length) {
      const length = view(bytes).getUint32(at);
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      if (type === 'sRGB') return { kind: 'srgb-chunk' };
      if (type === 'iCCP') return { kind: 'icc', profile: new Uint8Array(0), description: null };
      if (type === 'IDAT' || type === 'IEND') break;
      at += 12 + length;
    }
    return { kind: 'none' };
  }
  throw new Error('This is not a JPEG or PNG file.');
}

/** The profile's English description ('desc' tag, v2 text or v4 mluc), or null when it has none. */
export function iccDescription(profile: Uint8Array): string | null {
  if (profile.length < 132) return null;
  const data = view(profile);
  const count = data.getUint32(128);
  for (let i = 0; i < count && 132 + i * 12 + 12 <= profile.length; i += 1) {
    const entry = 132 + i * 12;
    if (data.getUint32(entry) !== 0x64657363) continue; // 'desc'
    const offset = data.getUint32(entry + 4);
    if (offset + 12 > profile.length) return null;
    const type = data.getUint32(offset);
    if (type === 0x64657363) { // v2 'desc': ASCII count then text
      const length = data.getUint32(offset + 8);
      return String.fromCharCode(...profile.subarray(offset + 12, offset + 12 + Math.max(0, length - 1)));
    }
    if (type === 0x6d6c7563) { // v4 'mluc': first record, UTF-16BE
      const length = data.getUint32(offset + 20), start = offset + data.getUint32(offset + 24);
      let text = '';
      for (let j = 0; j + 1 < length && start + j + 1 < profile.length; j += 2) text += String.fromCharCode(data.getUint16(start + j));
      return text.replace(/\0+$/, '');
    }
    return null;
  }
  return null;
}

/** One APP2 segment holding a whole profile (sequence 1 of 1). Profiles over ~64 KB would need splitting; ours are small. */
function jpegIccSegment(profile: Uint8Array): Uint8Array<ArrayBuffer> {
  const length = 2 + ICC_IDENTIFIER.length + 2 + profile.length;
  if (length > 0xffff) throw new Error('The colour profile is too large for one JPEG segment.');
  const segment = new Uint8Array(2 + length);
  segment.set([0xff, 0xe2, length >>> 8, length & 255]);
  segment.set(ICC_IDENTIFIER, 4);
  segment.set([1, 1], 4 + ICC_IDENTIFIER.length);
  segment.set(profile, 6 + ICC_IDENTIFIER.length);
  return segment;
}

/** Where to put the profile (after JFIF APP0 and any Exif APP1, which readers expect first) and whether one is already there. */
async function jpegHeader(raster: Blob): Promise<{ hasIcc: boolean; insertAt: number }> {
  const bytes = new Uint8Array(await raster.slice(0, Math.min(raster.size, JPEG_HEADER_LIMIT)).arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('The encoded JPEG is invalid, so no colour profile was added.');
  let at = 2, insertAt = 2;
  for (;;) {
    if (at + 4 > bytes.length || bytes[at] !== 0xff) throw new Error('The encoded JPEG header could not be read, so no colour profile was added.');
    const marker = bytes[at + 1];
    if (marker === 0xda || marker === 0xd9) return { hasIcc: false, insertAt };
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2) throw new Error('The encoded JPEG header could not be read, so no colour profile was added.');
    if (marker === 0xe2 && startsWith(bytes.subarray(at + 4), ICC_IDENTIFIER)) return { hasIcc: true, insertAt };
    at += 2 + length;
    if (marker === 0xe0 || marker === 0xe1) insertAt = at;
  }
}

/** Where IHDR ends, and whether an sRGB or iCCP chunk is already present before the picture data. */
async function pngHeader(raster: Blob): Promise<{ tagged: boolean; afterIhdr: number }> {
  const head = new Uint8Array(await raster.slice(0, 33).arrayBuffer());
  if (head.length < 33 || PNG_SIGNATURE.some((byte, i) => head[i] !== byte) || String.fromCharCode(...head.subarray(12, 16)) !== 'IHDR')
    throw new Error('The encoded PNG is invalid, so no colour profile was added.');
  let at = 8;
  for (;;) {
    const top = new Uint8Array(await raster.slice(at, at + 8).arrayBuffer());
    if (top.length < 8) throw new Error('The encoded PNG ended early, so no colour profile was added.');
    const type = String.fromCharCode(...top.subarray(4, 8));
    if (type === 'sRGB' || type === 'iCCP') return { tagged: true, afterIhdr: 33 };
    if (type === 'IDAT' || type === 'IEND') return { tagged: false, afterIhdr: 33 };
    at += 12 + view(top).getUint32(0);
  }
}

function pngChunk(type: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + body.length);
  const data = view(out);
  data.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  data.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, i) => bytes[i] === byte);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
