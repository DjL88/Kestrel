import { readFileSync } from 'node:fs';

/** A 96 × 64 Bayer mosaic written by ticoraw's DNG writer, orientation 6. Synthetic: no camera data. */
export const mosaic = readFileSync(new URL('./fixtures/synthetic-z8.dng', import.meta.url));

export /** Add a second TIFF directory pointing at a JPEG preview, the way RAW files carry one (tags 0x0201 and 0x0202). */
function withPreview(dng: Buffer, jpeg: Buffer): Buffer {
  if (dng.readUInt16LE(0) !== 0x4949) throw new Error('expected a little-endian DNG');
  const first = dng.readUInt32LE(4);
  const nextPointerAt = first + 2 + dng.readUInt16LE(first) * 12;
  const padded = (length: number) => length + (length % 2);
  const previewAt = padded(dng.length);
  const directoryAt = padded(previewAt + jpeg.length);
  const out = Buffer.alloc(directoryAt + 2 + 2 * 12 + 4);
  dng.copy(out, 0);
  jpeg.copy(out, previewAt);
  out.writeUInt32LE(directoryAt, nextPointerAt);
  out.writeUInt16LE(2, directoryAt);
  const entry = (index: number, tag: number, value: number) => {
    const at = directoryAt + 2 + index * 12;
    out.writeUInt16LE(tag, at); out.writeUInt16LE(4, at + 2); out.writeUInt32LE(1, at + 4); out.writeUInt32LE(value, at + 8);
  };
  entry(0, 0x0201, previewAt);
  entry(1, 0x0202, jpeg.length);
  out.writeUInt32LE(0, directoryAt + 2 + 2 * 12);
  return out;
}
