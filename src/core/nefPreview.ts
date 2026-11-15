import { extractEmbeddedJpegFromRawBuffer } from './exifParser';

const FALLBACK_BYTES = 28 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 48 * 1024 * 1024;
const MAX_DIRECTORIES = 24;
const MAX_TAGS = 1024;
const MAX_SUB_DIRECTORIES = 16;

async function locatePreview(file: Blob): Promise<Blob | null> {
  if (file.size < 8) return null;
  const read = async (offset: number, length: number) =>
    offset >= 0 && offset + length <= file.size
      ? new DataView(await file.slice(offset, offset + length).arrayBuffer())
      : null;
  const header = await read(0, 8);
  if (!header) return null;
  const candidates: { offset: number; length: number }[] = [];
  // Fujifilm RAF: a text header, then where its JPEG starts and how long it is (big-endian), at byte 84.
  const rafMagic = await read(0, 16);
  if (rafMagic && new TextDecoder().decode(new Uint8Array(rafMagic.buffer)) === 'FUJIFILMCCD-RAW ') {
    const place = await read(84, 8);
    if (place) candidates.push({ offset: place.getUint32(0), length: place.getUint32(4) });
    return pickBest(file, candidates, read);
  }
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

    let start = 0;
    let length = 0;
    let stripStart = 0;
    let stripLength = 0;
    for (let index = 0; index < count; index += 1) {
      const entry = index * 12;
      const tag = directory.getUint16(entry, little);
      if (tag !== 0x0201 && tag !== 0x0202 && tag !== 0x014a && tag !== 0x8769 && tag !== 0x0111 && tag !== 0x0117) continue;
      const type = directory.getUint16(entry + 2, little);
      const size = directory.getUint32(entry + 4, little);
      // TIFF SubIFDs and EXIF IFDs may contain the only usable embedded JPEG. Follow both
      // within the same bounded, cycle-safe traversal; never scan or decode sensor pixels.
      if ((tag === 0x014a || tag === 0x8769) && (type === 4 || type === 13) && size > 0 && size <= MAX_SUB_DIRECTORIES && (tag !== 0x8769 || size === 1)) {
        const value = directory.getUint32(entry + 8, little);
        if (size === 1) pending.push(value);
        else {
          const offsets = await read(value, size * 4);
          if (offsets) {
            for (let j = 0; j < size; j += 1) pending.push(offsets.getUint32(j * 4, little));
          }
        }
      } else if ((tag === 0x0201 || tag === 0x0202 || tag === 0x0111 || tag === 0x0117) && size === 1 && (type === 3 || type === 4)) {
        const value = type === 3 ? directory.getUint16(entry + 8, little) : directory.getUint32(entry + 8, little);
        if (tag === 0x0201) start = value;
        else if (tag === 0x0202) length = value;
        // Canon CR2 keeps its preview as the single strip of the first directory; whether it is a JPEG is checked below.
        else if (tag === 0x0111) stripStart = value;
        else stripLength = value;
      }
    }
    pending.push(directory.getUint32(count * 12, little));
    if (start >= 8 && length >= 4096 && length <= MAX_PREVIEW_BYTES && start + length <= file.size) {
      candidates.push({ offset: start, length });
    }
    if (stripStart >= 8 && stripLength >= 4096 && stripLength <= MAX_PREVIEW_BYTES && stripStart + stripLength <= file.size) {
      candidates.push({ offset: stripStart, length: stripLength });
    }
  }
  return pickBest(file, candidates, read);
}

async function pickBest(file: Blob, candidates: { offset: number; length: number }[], read: (offset: number, length: number) => Promise<DataView | null>): Promise<Blob | null> {
  // JPEG byte size depends on compression and detail. Prefer actual pixel area.
  let best: { preview: Blob; pixels: number } | null = null;
  for (const { offset, length } of candidates) {
    const first = await read(offset, 3);
    const last = await read(offset + length - 2, 2);
    if (first?.getUint16(0) === 0xffd8 && first.getUint8(2) === 0xff && last?.getUint16(0) === 0xffd9) {
      const preview = file.slice(offset, offset + length, 'image/jpeg');
      const pixels = await usefulPixelCount(preview);
      if (pixels && (!best || pixels > best.pixels || (pixels === best.pixels && length > best.preview.size))) {
        best = { preview, pixels };
      }
    }
  }
  return best?.preview ?? null;
}

async function usefulPixelCount(preview: Blob): Promise<number> {
  const data = new DataView(await preview.slice(0, 256 * 1024).arrayBuffer());
  let offset = 2;
  while (offset + 4 < data.byteLength && data.getUint8(offset) === 0xff) {
    const marker = data.getUint8(offset + 1);
    if (marker === 0xff) { offset += 1; continue; }
    if (marker === 0xda || marker === 0xd9) break;
    const length = data.getUint16(offset + 2);
    if (length < 2) break;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // Both dimensions must be plausible. A corrupt SOF with a 1-pixel
      // height used to pass because only the larger dimension was checked.
      // A truncated or fabricated SOF segment must not certify a RAW preview.
      if (length < 8 || offset + 2 + length > data.byteLength) return 0;
      const height = data.getUint16(offset + 5);
      const width = data.getUint16(offset + 7);
      return width >= 320 && height >= 320 && Math.max(width, height) >= 640 ? width * height : 0;
    }
    offset += 2 + length;
  }
  return 0;
}

/**
 * The JPEG preview inside a camera RAW file: Nikon NEF and NRW, Sony ARW, Canon CR2 and CR3, Fujifilm RAF and other
 * TIFF-style files. Uses the file's own directory where it has one, otherwise looks for a JPEG inside it (this is how
 * Canon CR3, a different kind of container, is handled). Returns null when no usable preview exists.
 */
export async function extractRawPreview(file: Blob): Promise<Blob | null> {
  const located = await locatePreview(file);
  if (located) return located;
  const fallback = extractEmbeddedJpegFromRawBuffer(await file.slice(0, FALLBACK_BYTES).arrayBuffer());
  if (fallback) {
    const candidate = new Blob([fallback.bytes.slice()], { type: 'image/jpeg' });
    // A byte-pattern match alone is not proof of a decodable photo preview.
    // Reject tiny or malformed JPEGs rather than offering them as NEF previews.
    if (await usefulPixelCount(candidate)) return candidate;
  }
  return null;
}

/** The old name, kept so existing callers keep working. */
export const extractNefPreview = extractRawPreview;
