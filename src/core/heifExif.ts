// HEIF stores EXIF as a metadata item rather than a JPEG APP1 segment.
// Read the declared location, including its base offset, without decoding pixels.
const MAX_METADATA_BYTES = 1024 * 1024;
type Box = { type: string; start: number; end: number };

function boxAt(data: DataView, offset: number, limit: number): Box | undefined {
  if (offset + 8 > data.byteLength) return;
  const size = data.getUint32(offset);
  const type = String.fromCharCode(...new Uint8Array(data.buffer, data.byteOffset + offset + 4, 4));
  const header = size === 1 ? 16 : 8;
  if (offset + header > data.byteLength) return;
  const end = size === 0 ? limit : offset + (size === 1 ? Number(data.getBigUint64(offset + 8)) : size);
  if (!Number.isSafeInteger(end) || end < offset + header || end > limit) return;
  return { type, start: offset + header, end };
}

function* boxes(data: DataView, offset: number, limit: number): Generator<Box> {
  while (offset < limit) {
    const box = boxAt(data, offset, limit);
    if (!box) return;
    yield box;
    offset = box.end;
  }
}

function exifItemId(data: DataView, info: Box): number | undefined {
  const version = data.getUint8(info.start);
  if (version !== 0 && version !== 1) return;
  for (const entry of boxes(data, info.start + (version === 0 ? 6 : 8), info.end)) {
    if (entry.type !== 'infe' || entry.start + 4 > entry.end) continue;
    const version = data.getUint8(entry.start);
    if (version !== 2 && version !== 3) continue;
    const idSize = version === 2 ? 2 : 4;
    const start = entry.start + 4;
    const typeAt = start + idSize + 2;
    if (typeAt + 4 <= entry.end && data.getUint32(typeAt) === 0x45786966) {
      return version === 2 ? data.getUint16(start) : data.getUint32(start);
    }
  }
}

function exifExtent(data: DataView, location: Box, id: number) {
  let cursor = location.start;
  function read(size: number): number {
    if (size > 8 || cursor + size > location.end) throw new RangeError('Invalid HEIF item location');
    let number = 0;
    for (let i = 0; i < size; i++) number = number * 256 + data.getUint8(cursor++);
    if (!Number.isSafeInteger(number)) throw new RangeError('Invalid HEIF offset');
    return number;
  }
  const version = read(1);
  if (version > 2) return;
  read(3); // flags
  const widths = read(1);
  const baseAndIndex = read(1);
  const count = read(version === 2 ? 4 : 2);
  for (let i = 0; i < count; i++) {
    const itemId = read(version === 2 ? 4 : 2);
    const method = version === 0 ? 0 : read(2);
    const reference = read(2);
    const base = read(baseAndIndex >> 4);
    const extents = read(2);
    if (itemId === id && (method !== 0 || reference !== 0 || extents !== 1)) return;
    for (let j = 0; j < extents; j++) {
      if (version !== 0) read(baseAndIndex & 15);
      const offset = read(widths >> 4);
      const length = read(widths & 15);
      if (itemId === id) return { start: base + offset, length };
    }
  }
}

/** An inline, single-extent EXIF item. Unsupported or damaged metadata leaves the photo without EXIF. */
export async function readHeifExif(file: Blob): Promise<Uint8Array | undefined> {
  try {
    for (let offset = 0, count = 0; offset < file.size && count < 128; count++) {
      const header = new DataView(await file.slice(offset, offset + 16).arrayBuffer());
      const box = boxAt(header, 0, file.size - offset);
      if (!box) return;
      if (box.type === 'meta') {
        if (box.end - box.start > MAX_METADATA_BYTES) return;
        const data = new DataView(await file.slice(offset + box.start, offset + box.end).arrayBuffer());
        const children = [...boxes(data, 4, data.byteLength)];
        const info = children.find(child => child.type === 'iinf');
        const location = children.find(child => child.type === 'iloc');
        const id = info && exifItemId(data, info);
        if (id === undefined || !location) return;
        const extent = exifExtent(data, location, id);
        if (!extent || extent.length < 12 || extent.length > MAX_METADATA_BYTES ||
            !Number.isSafeInteger(extent.start + extent.length) || extent.start + extent.length > file.size) return;
        const item = new DataView(await file.slice(extent.start, extent.start + extent.length).arrayBuffer());
        const tiff = 4 + item.getUint32(0);
        if (tiff + 8 > item.byteLength) return;
        const signature = item.getUint32(tiff);
        if (signature !== 0x49492a00 && signature !== 0x4d4d002a) return;
        return new Uint8Array(item.buffer, tiff);
      }
      offset += box.end;
    }
  } catch {
    // Corrupt optional metadata must never stop import.
  }
}
