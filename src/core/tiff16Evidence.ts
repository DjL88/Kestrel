/**
 * Structural check of a completed classic TIFF file, not proof of RAW origin,
 * pixel values, colour accuracy or a genuine ICC profile. Pair with independently
 * verified original identity and decoder-to-encoder provenance before any RAW16 claim.
 * Deliberately refuses BigTIFF and malformed/unsupported layouts.
 */
export function inspectTiff16Structure(bytes: Uint8Array): { ok: true; width: number; height: number; samples: number } | { ok: false; reason: string } {
  const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
  if (bytes.byteLength < 8) return fail('TIFF header is missing.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  if (!little && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) return fail('Not a TIFF byte-order signature.');
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);
  if (u16(2) !== 42) return fail('Not a supported classic TIFF.');
  const inRange = (at: number, size: number) => Number.isSafeInteger(at) && at >= 0 && size >= 0 && at + size <= bytes.byteLength;
  const ifd = u32(4);
  if (!inRange(ifd, 2)) return fail('TIFF directory is out of bounds.');
  const count = u16(ifd);
  if (count > 256 || !inRange(ifd + 2, count * 12 + 4)) return fail('TIFF directory is malformed.');
  const tags = new Map<number, { type: number; count: number; offset: number }>();
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12;
    const tag = u16(at);
    if (tags.has(tag)) return fail('Duplicate TIFF tag.');
    tags.set(tag, { type: u16(at + 2), count: u32(at + 4), offset: at + 8 });
  }
  const values = (tag: number): number[] | null => {
    const t = tags.get(tag);
    if (!t || ![3, 4].includes(t.type) || t.count < 1 || t.count > 8) return null;
    const width = t.type === 3 ? 2 : 4;
    const total = t.count * width;
    const start = total <= 4 ? t.offset : u32(t.offset);
    if (!inRange(start, total)) return null;
    return Array.from({ length: t.count }, (_, i) => t.type === 3 ? u16(start + i * 2) : u32(start + i * 4));
  };
  const width = values(256)?.[0], height = values(257)?.[0];
  const samples = values(277)?.[0], bits = values(258);
  if (!width || !height || !Number.isSafeInteger(width * height)) return fail('Invalid TIFF dimensions.');
  if (!samples || samples < 1 || samples > 4 || !bits || bits.length !== samples || bits.some(bit => bit !== 16)) {
    return fail('TIFF does not declare 16 bits for every channel.');
  }
  const icc = tags.get(34675);
  if (!icc || ![1, 7].includes(icc.type) || icc.count < 128 || !inRange(u32(icc.offset), icc.count)) {
    return fail('TIFF has no bounded embedded ICC profile payload.');
  }
  // A well-formed ICC profile starts with its byte size and acsp signature.
  const iccAt = u32(icc.offset);
  const profileSize = new DataView(bytes.buffer, bytes.byteOffset + iccAt, 4).getUint32(0, false);
  if (profileSize < 128 || profileSize > icc.count ||
      String.fromCharCode(...bytes.subarray(iccAt + 36, iccAt + 40)) !== 'acsp') {
    return fail('Embedded ICC profile header is invalid.');
  }
  return { ok: true, width, height, samples };
}
