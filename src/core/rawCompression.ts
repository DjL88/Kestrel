/**
 * Whether a RAW's main image uses a compression InFlight's decoder cannot read yet, from its TIFF directories only (a
 * few kilobytes; the sensor data is never read). Today that is JPEG XL (TIFF Compression 52546), which Lightroom writes
 * in its linear "enhanced" DNGs (DNG 1.7). Knowing this lets every screen say so plainly instead of "original
 * unavailable" or a decoder message. Pure: works on any Blob, including a ranged read of a linked file.
 */
export type UnsupportedRawCompression = 'jpeg-xl';

const JPEG_XL = 52546;
const MAX_DIRECTORIES = 24;
const MAX_TAGS = 1024;
const MAX_SUB_DIRECTORIES = 16;

export async function unsupportedRawCompression(file: Blob): Promise<UnsupportedRawCompression | null> {
  if (file.size < 16) return null;
  const read = async (offset: number, length: number) =>
    offset >= 0 && length > 0 && offset + length <= file.size
      ? new DataView(await file.slice(offset, offset + length).arrayBuffer())
      : null;
  const header = await read(0, 8);
  if (!header) return null;
  const order = header.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  if (header.getUint16(2, little) !== 42) return null;

  const pending = [header.getUint32(4, little)];
  const visited = new Set<number>();
  while (pending.length && visited.size < MAX_DIRECTORIES) {
    const offset = pending.shift()!;
    if (offset < 8 || visited.has(offset)) continue;
    visited.add(offset);
    const countView = await read(offset, 2);
    if (!countView) continue;
    const count = countView.getUint16(0, little);
    if (count > MAX_TAGS) continue;
    const directory = await read(offset + 2, count * 12 + 4);
    if (!directory) continue;
    let subfileType = 0;
    let compression: number | null = null;
    for (let index = 0; index < count; index += 1) {
      const entry = index * 12;
      const tag = directory.getUint16(entry, little);
      const type = directory.getUint16(entry + 2, little);
      const size = directory.getUint32(entry + 4, little);
      const value = type === 3 ? directory.getUint16(entry + 8, little) : directory.getUint32(entry + 8, little);
      if (tag === 0x00fe && size === 1) subfileType = value;
      else if (tag === 0x0103 && size === 1 && (type === 3 || type === 4)) compression = value;
      else if (tag === 0x014a && (type === 4 || type === 13) && size > 0 && size <= MAX_SUB_DIRECTORIES) {
        if (size === 1) pending.push(value);
        else {
          const offsets = await read(value, size * 4);
          if (offsets) for (let j = 0; j < size; j += 1) pending.push(offsets.getUint32(j * 4, little));
        }
      }
    }
    // NewSubfileType 0 is the main (full-resolution) image; previews and transparency masks don't decide it.
    if (subfileType === 0 && compression === JPEG_XL) return 'jpeg-xl';
    pending.push(directory.getUint32(count * 12, little));
  }
  return null;
}
