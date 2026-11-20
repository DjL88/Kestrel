/**
 * Find the EXIF block inside a HEIF file (HEIC, HEIF or HIF), so its capture time and camera can be read like a JPEG's.
 *
 * HEIF keeps EXIF as an item called "Exif" in the `meta` box: `iinf` names it, `iloc` says where its bytes are. Some
 * writers (libheif, and so many converters and cameras) give each item a base offset; exifr 7 ignores that and then
 * reports "Malformed EXIF data", so Kestrel locates the block itself and hands exifr plain TIFF bytes. Pure: bytes in,
 * bytes out. Anything unexpected answers null (unknown stays unknown), never a guess.
 */

interface Box { type: string; start: number; end: number }

function readUint(view: DataView, at: number, size: number): number {
  if (size === 0) return 0;
  if (size === 1) return view.getUint8(at);
  if (size === 2) return view.getUint16(at);
  if (size === 4) return view.getUint32(at);
  if (size === 8) {
    const high = view.getUint32(at);
    if (high > 0x1fffff) throw new RangeError('offset too large');
    return high * 2 ** 32 + view.getUint32(at + 4);
  }
  throw new RangeError('unsupported field size');
}

function* boxes(view: DataView, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    const type = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7));
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) return;
      size = readUint(view, at + 8, 8);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) return;
    yield { type, start: at + header, end: at + size };
    at += size;
  }
}

const find = (view: DataView, start: number, end: number, type: string) => {
  for (const box of boxes(view, start, end)) if (box.type === type) return box;
  return undefined;
};

/** The item ID of the "Exif" item in `iinf`, or undefined. */
function exifItemId(view: DataView, iinf: Box): number | undefined {
  const version = view.getUint8(iinf.start);
  const entriesStart = iinf.start + 4 + (version === 0 ? 2 : 4);
  for (const infe of boxes(view, entriesStart, iinf.end)) {
    if (infe.type !== 'infe') continue;
    const infeVersion = view.getUint8(infe.start);
    if (infeVersion < 2) continue;
    const idSize = infeVersion === 2 ? 2 : 4;
    const id = readUint(view, infe.start + 4, idSize);
    const typeAt = infe.start + 4 + idSize + 2;
    if (typeAt + 4 > infe.end) continue;
    const itemType = String.fromCharCode(view.getUint8(typeAt), view.getUint8(typeAt + 1), view.getUint8(typeAt + 2), view.getUint8(typeAt + 3));
    if (itemType === 'Exif') return id;
  }
  return undefined;
}

/** Where the item's bytes are: one or more [offset, length] ranges in the file. */
function itemExtents(view: DataView, iloc: Box, itemId: number, idat: Box | undefined): Array<[number, number]> | undefined {
  const version = view.getUint8(iloc.start);
  let at = iloc.start + 4;
  const sizes = view.getUint8(at);
  const more = view.getUint8(at + 1);
  at += 2;
  const offsetSize = sizes >> 4;
  const lengthSize = sizes & 15;
  const baseOffsetSize = more >> 4;
  const indexSize = version === 1 || version === 2 ? more & 15 : 0;
  const count = version < 2 ? view.getUint16(at) : view.getUint32(at);
  at += version < 2 ? 2 : 4;
  for (let item = 0; item < count; item += 1) {
    const id = version < 2 ? view.getUint16(at) : view.getUint32(at);
    at += version < 2 ? 2 : 4;
    let method = 0;
    if (version === 1 || version === 2) {
      method = view.getUint16(at) & 15;
      at += 2;
    }
    at += 2; // data_reference_index
    const base = readUint(view, at, baseOffsetSize);
    at += baseOffsetSize;
    const extentCount = view.getUint16(at);
    at += 2;
    const extents: Array<[number, number]> = [];
    for (let extent = 0; extent < extentCount; extent += 1) {
      at += indexSize;
      const offset = readUint(view, at, offsetSize);
      at += offsetSize;
      const length = readUint(view, at, lengthSize);
      at += lengthSize;
      extents.push([base + offset, length]);
    }
    if (id !== itemId) continue;
    if (method === 0) return extents;
    if (method === 1 && idat) return extents.map(([offset, length]) => [idat.start + offset, length]);
    return undefined;
  }
  return undefined;
}

/** The TIFF bytes ("II*\0" or "MM\0*") of a HEIF file's EXIF, or null when there is none or it cannot be found. */
export function heifExifTiff(bytes: Uint8Array): Uint8Array | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const meta = find(view, 0, bytes.byteLength, 'meta');
    if (!meta) return null;
    const children = meta.start + 4; // meta is a full box
    const iinf = find(view, children, meta.end, 'iinf');
    const iloc = find(view, children, meta.end, 'iloc');
    if (!iinf || !iloc) return null;
    const id = exifItemId(view, iinf);
    if (id === undefined) return null;
    const extents = itemExtents(view, iloc, id, find(view, children, meta.end, 'idat'));
    if (!extents?.length) return null;
    const total = extents.reduce((sum, [, length]) => sum + length, 0);
    if (total < 12) return null;
    const payload = new Uint8Array(total);
    let written = 0;
    for (const [offset, length] of extents) {
      if (offset < 0 || offset + length > bytes.byteLength) return null;
      payload.set(bytes.subarray(offset, offset + length), written);
      written += length;
    }
    // The payload starts with the distance to the TIFF header (usually 6, skipping "Exif\0\0").
    const skip = 4 + new DataView(payload.buffer).getUint32(0);
    if (skip + 8 > payload.length) return null;
    const tiff = payload.subarray(skip);
    const isTiff = (tiff[0] === 0x49 && tiff[1] === 0x49 && tiff[2] === 0x2a && tiff[3] === 0)
      || (tiff[0] === 0x4d && tiff[1] === 0x4d && tiff[2] === 0 && tiff[3] === 0x2a);
    return isTiff ? tiff : null;
  } catch {
    return null;
  }
}
