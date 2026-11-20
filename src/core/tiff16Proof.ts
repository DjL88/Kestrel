/**
 * Structural proof for the native high-precision TIFF response. This proves
 * container layout only: it does NOT prove sensor origin, Nikon colour accuracy,
 * commercial codec rights or a high-precision editor pipeline.
 *
 * Current native export contract is uncompressed, chunky, single-strip RGB16.
 * Reject unknown layouts rather than presenting them as verified masters.
 */
export interface Tiff16Proof { width: number; height: number; iccBytes: number }
export function proveTiff16(bytes: ArrayBuffer): Tiff16Proof {
  const fail = (reason: string): never => { throw new Error('The RAW 16-bit output could not be verified: ' + reason); };
  const v = new DataView(bytes);
  const size = v.byteLength;
  if (size < 8) return fail('truncated TIFF header.');
  const order = v.getUint16(0, false);
  if (order !== 0x4949 && order !== 0x4d4d) return fail('invalid byte order.');
  const le = order === 0x4949;
  const u16 = (at: number): number => { if (!Number.isSafeInteger(at) || at < 0 || at + 2 > size) return fail('truncated TIFF field.'); return v.getUint16(at, le); };
  const u32 = (at: number): number => { if (!Number.isSafeInteger(at) || at < 0 || at + 4 > size) return fail('truncated TIFF field.'); return v.getUint32(at, le); };
  const range = (at: number, length: number): void => {
    if (!Number.isSafeInteger(at) || !Number.isSafeInteger(length) || at < 0 || length < 0 || at > size || length > size - at) fail('out-of-bounds TIFF data.');
  };
  if (u16(2) !== 42) return fail('unsupported TIFF format.');
  const ifd = u32(4);
  range(ifd, 2);
  const count = u16(ifd);
  if (count < 9 || count > 256) return fail('invalid TIFF tag count.');
  range(ifd + 2, count * 12 + 4);
  const tags = new Map<number, { type: number; count: number; value: number; at: number }>();
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12;
    const tag = u16(at), type = u16(at + 2), n = u32(at + 4);
    if (tags.has(tag)) return fail('duplicate TIFF tag.');
    tags.set(tag, { type, count: n, value: type === 3 && n === 1 ? u16(at + 8) : u32(at + 8), at });
  }
  const one = (tag: number, type: number): number => {
    const t = tags.get(tag);
    if (!t || t.type !== type || t.count !== 1) return fail('missing or incompatible TIFF tag ' + tag + '.');
    return t.value;
  };
  const width = one(256, 4), height = one(257, 4);
  const pixels = width * height;
  if (!width || !height || !Number.isSafeInteger(pixels) || pixels > 80_000_000) return fail('invalid or oversized image dimensions.');
  const bits = tags.get(258);
  if (!bits || bits.type !== 3 || bits.count !== 3) return fail('not three-channel 16-bit RGB.');
  range(bits.value, 6);
  if ([0, 2, 4].some(offset => u16(bits.value + offset) !== 16)) return fail('pixel precision is not 16-bit.');
  if (one(259, 3) !== 1 || one(262, 3) !== 2 || one(277, 3) !== 3 ||
      one(284, 3) !== 1 || one(278, 4) !== height) return fail('unsupported pixel layout.');
  const start = one(273, 4), byteCount = one(279, 4);
  if (byteCount !== pixels * 6) return fail('pixel byte count does not match dimensions.');
  range(start, byteCount);
  const icc = tags.get(34675);
  if (!icc || icc.type !== 7 || icc.count < 128 || icc.count > 16 * 1024 * 1024) return fail('missing or invalid ICC profile.');
  range(icc.value, icc.count);
  if (v.getUint32(icc.value, false) !== icc.count) return fail('ICC declared size differs from TIFF tag.');
  const ascii = (at: number) => String.fromCharCode(...new Uint8Array(bytes, at, 4));
  if (ascii(icc.value + 36) !== 'acsp' || ascii(icc.value + 16) !== 'RGB ') return fail('ICC is not a valid RGB profile header.');
  // Disallow the image and ICC profile overlapping: a corrupt offset can
  // otherwise make arbitrary pixels appear to contain profile metadata.
  if (start < icc.value + icc.count && icc.value < start + byteCount) return fail('ICC overlaps pixel data.');
  return { width, height, iccBytes: icc.count };
}
