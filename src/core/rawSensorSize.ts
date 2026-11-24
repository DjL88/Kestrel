/**
 * The recorded image size of a TIFF-based RAW (Nikon NEF, DNG, Canon CR2, Sony ARW, Pentax PEF, Olympus ORF,
 * Panasonic RW2...), read from the file's own IFDs. Many cameras (the Nikon Z5II among them) record no EXIF
 * ImageWidth for the picture, only for a thumbnail, so EXIF alone leaves the photo's shape unknown and the Original
 * format falls back to 1x1. This walks IFD0 and its SubIFDs, takes the full-resolution primary image (prefers DNG
 * DefaultCropSize), and applies the EXIF Orientation so portrait frames come out portrait.
 *
 * Evidence for the format's shape only; it does not prove full native pixels are available to export.
 * Returns null on anything malformed. Reads only the bytes given (the first ~1 MiB is enough for these cameras).
 */
export interface RawSensorSize { width: number; height: number }

const TAG = { newSubfileType: 254, width: 256, height: 257, orientation: 274, subIfds: 330, defaultCropSize: 50720 } as const;
const MAX_IFDS = 24;
const MAX_ENTRIES = 512;

export function rawSensorSize(bytes: Uint8Array): RawSensorSize | null {
  if (bytes.length < 16) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = String.fromCharCode(bytes[0], bytes[1]);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const magic = view.getUint16(2, little);
  // 42 = TIFF; 0x4F52 / 0x5352 = Olympus ORF; 0x55 = Panasonic RW2.
  if (![42, 0x4f52, 0x5352, 0x55].includes(magic)) return null;
  const u16 = (at: number) => (at + 2 <= bytes.length ? view.getUint16(at, little) : null);
  const u32 = (at: number) => (at + 4 <= bytes.length ? view.getUint32(at, little) : null);

  interface Ifd { newType: number | null; width: number | null; height: number | null; orientation: number | null; subIfds: number[]; crop: [number, number] | null }
  const readValue = (type: number, at: number): number | null => (type === 3 ? u16(at) : type === 4 || type === 13 ? u32(at) : type === 5 ? rational(at) : null);
  const rational = (at: number) => { const n = u32(at); const d = u32(at + 4); return n !== null && d ? n / d : null; };

  const readIfd = (offset: number): Ifd | null => {
    const count = u16(offset);
    if (count === null || count === 0 || count > MAX_ENTRIES) return null;
    const ifd: Ifd = { newType: null, width: null, height: null, orientation: null, subIfds: [], crop: null };
    for (let i = 0; i < count; i += 1) {
      const entry = offset + 2 + i * 12;
      const tag = u16(entry); const type = u16(entry + 2); const n = u32(entry + 4);
      if (tag === null || type === null || n === null) return null;
      const size = type === 3 ? 2 : type === 5 ? 8 : 4;
      const valueAt = n * size <= 4 ? entry + 8 : u32(entry + 8);
      if (valueAt === null) continue;
      if (tag === TAG.newSubfileType) ifd.newType = readValue(type, valueAt);
      else if (tag === TAG.width) ifd.width = readValue(type, valueAt);
      else if (tag === TAG.height) ifd.height = readValue(type, valueAt);
      else if (tag === TAG.orientation) ifd.orientation = readValue(type, valueAt);
      else if (tag === TAG.subIfds) {
        for (let k = 0; k < Math.min(n, MAX_IFDS); k += 1) { const sub = u32(valueAt + k * 4); if (sub) ifd.subIfds.push(sub); }
      } else if (tag === TAG.defaultCropSize && n === 2) {
        const w = readValue(type, valueAt); const h = readValue(type, valueAt + size);
        if (w && h) ifd.crop = [w, h];
      }
    }
    return ifd;
  };

  const first = u32(4);
  if (!first) return null;
  const ifd0 = readIfd(first);
  if (!ifd0) return null;
  const candidates: Ifd[] = [ifd0];
  const seen = new Set<number>([first]);
  const queue = [...ifd0.subIfds];
  while (queue.length && seen.size < MAX_IFDS) {
    const at = queue.shift()!;
    if (seen.has(at)) continue;
    seen.add(at);
    const sub = readIfd(at);
    if (!sub) continue;
    candidates.push(sub);
    queue.push(...sub.subIfds);
  }
  // The primary image: NewSubfileType 0 (not a reduced-resolution preview), largest area.
  let best: { w: number; h: number } | null = null;
  for (const ifd of candidates) {
    if (ifd.newType !== null && ifd.newType !== 0) continue;
    const w = ifd.crop?.[0] ?? ifd.width; const h = ifd.crop?.[1] ?? ifd.height;
    if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h)) continue;
    if (!best || w * h > best.w * best.h) best = { w: Math.round(w), h: Math.round(h) };
  }
  // A real camera sensor, not a thumbnail: at least 640 px on the long edge and a sane aspect ratio.
  if (!best || Math.max(best.w, best.h) < 640 || Math.max(best.w, best.h) > 40000 || Math.max(best.w / best.h, best.h / best.w) > 4) return null;
  const turned = ifd0.orientation !== null && ifd0.orientation >= 5 && ifd0.orientation <= 8;
  return turned ? { width: best.h, height: best.w } : { width: best.w, height: best.h };
}
