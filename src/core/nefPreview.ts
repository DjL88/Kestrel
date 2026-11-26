import { extractEmbeddedJpegFromRawBuffer } from './exifParser';

const FALLBACK_STEPS = [4, 12, 28].map((megabytes) => megabytes * 1024 * 1024);
const MAX_PREVIEW_BYTES = 48 * 1024 * 1024;
// A corrupt JPEG header must not ask the browser to allocate a multi-gigapixel bitmap.
// Nikon Z8 full-resolution photographs are ~46 MP; allow generous headroom.
const MAX_PREVIEW_PIXELS = 200_000_000;
const MAX_DIRECTORIES = 24;
const MAX_TAGS = 1024;
const MAX_SUB_DIRECTORIES = 16;
const PREVIEW_LONG_EDGE = 640;
const SMALL_PREVIEW_LONG_EDGE = 160;

async function locatePreview(file: Blob, minEdge: number): Promise<Blob | null> {
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
    return pickBest(file, candidates, read, minEdge);
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
    // A 256 px thumbnail can be under 4 KB; only the last-resort small preview accepts one.
    const minBytes = minEdge < PREVIEW_LONG_EDGE ? 512 : 4096;
    if (start >= 8 && length >= minBytes && length <= MAX_PREVIEW_BYTES && start + length <= file.size) {
      candidates.push({ offset: start, length });
    }
    if (stripStart >= 8 && stripLength >= minBytes && stripLength <= MAX_PREVIEW_BYTES && stripStart + stripLength <= file.size) {
      candidates.push({ offset: stripStart, length: stripLength });
    }
  }
  return pickBest(file, candidates, read, minEdge);
}

async function pickBest(file: Blob, candidates: { offset: number; length: number }[], read: (offset: number, length: number) => Promise<DataView | null>, minEdge: number): Promise<Blob | null> {
  // JPEG byte size depends on compression and detail. Prefer actual pixel area.
  let best: { preview: Blob; pixels: number } | null = null;
  for (const { offset, length } of candidates) {
    const first = await read(offset, 3);
    const last = await read(offset + length - 2, 2);
    if (first?.getUint16(0) === 0xffd8 && first.getUint8(2) === 0xff && last?.getUint16(0) === 0xffd9) {
      const preview = file.slice(offset, offset + length, 'image/jpeg');
      const pixels = await usefulPixelCount(preview, minEdge);
      if (pixels && (!best || pixels > best.pixels || (pixels === best.pixels && length > best.preview.size))) {
        best = { preview, pixels };
      }
    }
  }
  return best?.preview ?? null;
}

/** A usable preview: at least `minEdge` px on its long side (the normal 640, or less for the last-resort small one). */
async function usefulPixelCount(preview: Blob, minEdge = PREVIEW_LONG_EDGE): Promise<number> {
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
      // A zero-bit sample precision is not a JPEG image. Do not trust its
      // advertised dimensions when choosing a RAW embedded preview.
      // JPEG frame sample precision is 8 bits for baseline/extended DCT,
      // 12 for extended DCT, or up to 16 for lossless JPEG. Reject
      // fabricated values before trusting the claimed dimensions.
      const precision = data.getUint8(offset + 4);
      if (precision < 2 || precision > 16 || (marker === 0xc0 && precision !== 8)) return 0;
      const height = data.getUint16(offset + 5);
      const width = data.getUint16(offset + 7);
      const components = data.getUint8(offset + 9);
      // SOF contains one three-byte descriptor per component. Reject truncated
      // or fabricated headers before trusting their advertised dimensions.
      if (components < 1 || components > 4 || length !== 8 + 3 * components) return 0;
      const pixels = width * height;
      const shortEdge = Math.min(320, Math.ceil(minEdge / 2));
      return width >= shortEdge && height >= shortEdge && Math.max(width, height) >= minEdge && pixels <= MAX_PREVIEW_PIXELS ? pixels : 0;
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
  const preview = await findRawPreview(file, PREVIEW_LONG_EDGE);
  return preview && orientPreview(preview, await rawOrientation(file));
}

/**
 * Last resort when a RAW has no preview of at least 640 px: its largest embedded JPEG down to 160 px on the long side,
 * such as the 256 px thumbnail of a Lightroom JPEG XL DNG whose larger previews are JPEG XL too. Only for showing that
 * a photo is there (labelled as the camera's preview); never a source for an export or a 100% view.
 */
export async function extractSmallRawPreview(file: Blob): Promise<Blob | null> {
  const preview = await findRawPreview(file, SMALL_PREVIEW_LONG_EDGE);
  return preview && orientPreview(preview, await rawOrientation(file));
}

async function findRawPreview(file: Blob, minEdge: number): Promise<Blob | null> {
  const located = await locatePreview(file, minEdge);
  if (located) return located;
  // Most camera-embedded JPEGs are near the front of a RAW file. Probe in
  // increasing bounded windows to avoid allocating 28 MiB for every thumbnail.
  // A failed early probe is not proof the file lacks a preview.
  let bestFallback: { blob: Blob; pixels: number } | null = null;
  for (const bytes of FALLBACK_STEPS) {
    const buffer = await file.slice(0, Math.min(file.size, bytes)).arrayBuffer();
    const fallback = extractEmbeddedJpegFromRawBuffer(buffer);
    if (!fallback) continue;
    const candidate = new Blob([fallback.bytes.slice()], { type: 'image/jpeg' });
    const pixels = await usefulPixelCount(candidate, minEdge);
    if (pixels > (bestFallback?.pixels ?? 0)) bestFallback = { blob: candidate, pixels };
    // A substantial full-frame preview is sufficient; do not keep reading the RAW.
    // Small camera thumbnails must not hide a larger preview later in the file.
    if (pixels >= 12_000_000) return candidate;
  }
  return bestFallback?.blob ?? null;
}

/**
 * The EXIF/TIFF Orientation (1 to 8) a TIFF-style RAW records in its first directory, or null when it records none.
 * Cameras store the sensor picture, and the embedded preview, the way the sensor lies; this says how the camera was held.
 */
export async function rawOrientation(file: Blob): Promise<number | null> {
  if (file.size < 16) return null;
  const head = new DataView(await file.slice(0, Math.min(file.size, 64 * 1024)).arrayBuffer());
  const order = head.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  // 42 = TIFF (NEF, DNG, CR2, ARW, PEF...); 0x4F52 / 0x5352 = Olympus ORF; 0x55 = Panasonic RW2.
  if (![42, 0x4f52, 0x5352, 0x55].includes(head.getUint16(2, little))) return null;
  return tiffOrientation(head, head.getUint32(4, little), little);
}

function tiffOrientation(view: DataView, ifd: number, little: boolean, base = 0): number | null {
  if (base + ifd + 2 > view.byteLength) return null;
  const count = view.getUint16(base + ifd, little);
  if (count === 0 || count > MAX_TAGS) return null;
  for (let i = 0; i < count; i += 1) {
    const entry = base + ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) return null;
    if (view.getUint16(entry, little) !== 0x0112 || view.getUint16(entry + 2, little) !== 3) continue;
    const value = view.getUint16(entry + 8, little);
    return value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

/** The embedded JPEG's own size and Orientation, from its header only. */
function jpegFacts(view: DataView): { width: number; height: number; orientation: number | null; insertAt: number } | null {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2, insertAt = 2, orientation: number | null = null;
  while (offset + 4 <= view.byteLength && view.getUint8(offset) === 0xff) {
    const marker = view.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) return null;
    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    if (marker === 0xe0) insertAt = offset + 2 + length;
    // An Exif APP1: "Exif\0\0", then a TIFF header whose first directory may hold the preview's own Orientation.
    if (marker === 0xe1 && offset + 18 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0) {
      const tiff = offset + 10;
      const order = view.getUint16(tiff);
      if (order === 0x4949 || order === 0x4d4d) {
        const little = order === 0x4949;
        orientation ??= tiffOrientation(view, view.getUint32(tiff + 4, little), little, tiff);
      }
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > view.byteLength) return null;
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7), orientation, insertAt };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * Give the embedded preview the RAW's Orientation, so every view (the browser, `createImageBitmap`, thumbnails and the
 * develop's orientation check, which follows the preview) shows a portrait photo upright. Nikon and most cameras write
 * the preview the way the sensor lies and record the turn only in the RAW, not in the preview itself.
 *
 * This adds a tiny Exif segment carrying only that Orientation; the preview's pixels are not re-encoded. Left as it is
 * when the RAW records no turn, when the preview has its own Orientation, or when the preview is already turned (a
 * quarter turn is recorded but the preview is already portrait).
 */
export async function orientPreview(preview: Blob, orientation: number | null): Promise<Blob> {
  if (!orientation || orientation === 1) return preview;
  const facts = jpegFacts(new DataView(await preview.slice(0, 256 * 1024).arrayBuffer()));
  if (!facts || facts.orientation !== null) return preview;
  const quarter = orientation >= 5;
  if (quarter && facts.height > facts.width) return preview;
  return new Blob([preview.slice(0, facts.insertAt), orientationSegment(orientation), preview.slice(facts.insertAt)], { type: 'image/jpeg' });
}

/** APP1 "Exif\0\0" with a little-endian TIFF header and one directory holding only Orientation (SHORT). 36 bytes. */
function orientationSegment(orientation: number): Uint8Array<ArrayBuffer> {
  const segment = new Uint8Array(36);
  const view = new DataView(segment.buffer);
  view.setUint16(0, 0xffe1);
  view.setUint16(2, 34);
  segment.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); // Exif\0\0
  segment.set([0x49, 0x49, 42, 0], 10); // II, 42
  view.setUint32(14, 8, true); // first directory straight after the header
  view.setUint16(18, 1, true); // one entry
  view.setUint16(20, 0x0112, true); // Orientation
  view.setUint16(22, 3, true); // SHORT
  view.setUint32(24, 1, true);
  view.setUint16(28, orientation, true);
  view.setUint32(32, 0, true); // no next directory
  return segment;
}

/** The old name, kept so existing callers keep working. */
export const extractNefPreview = extractRawPreview;
