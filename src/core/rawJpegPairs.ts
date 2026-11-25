import { isRawPreviewFile } from './rawFormats';
import type { PhotoFrame } from './types';

/**
 * RAW + JPEG pairs: a camera that writes both files for one shot gives them the same name with different extensions.
 * Kestrel keeps both files and shows them as one photo. A pair is made only when it is unambiguous: exactly one RAW
 * and one JPEG share the name, they come from the same folder, and, when both record a capture time, it matches to
 * within two seconds. Anything else stays as separate photos rather than being guessed into a pair.
 */
export interface RawJpegPairs {
  /** RAW frame id → its JPEG frame id. */
  jpegOf: Map<string, string>;
  /** JPEG frame id → its RAW frame id. These JPEGs are not shown as photos of their own. */
  rawOf: Map<string, string>;
}

const isJpeg = (name: string) => /\.jpe?g$/i.test(name);
const stem = (name: string) => name.replace(/\.[^.]+$/, '').normalize('NFC').toLowerCase();
/** The folder part of where the file came from, or '' when only a bare name is known. */
function folderOf(frame: PhotoFrame): string {
  const where = (frame.sourcePath ?? frame.stableKey ?? '').replace(/\\/g, '/');
  const cut = where.lastIndexOf('/');
  return cut >= 0 ? where.slice(0, cut).toLowerCase() : '';
}

export function rawJpegPairs(frames: readonly PhotoFrame[]): RawJpegPairs {
  const groups = new Map<string, { raws: PhotoFrame[]; jpegs: PhotoFrame[] }>();
  for (const frame of frames) {
    if (frame.removedAt || frame.isDemo || frame.virtualCopy) continue;
    const raw = isRawPreviewFile(frame.filename);
    if (!raw && !isJpeg(frame.filename)) continue;
    const key = `${folderOf(frame)}\u0000${stem(frame.filename)}`;
    const group = groups.get(key) ?? { raws: [], jpegs: [] };
    (raw ? group.raws : group.jpegs).push(frame);
    groups.set(key, group);
  }
  const jpegOf = new Map<string, string>();
  const rawOf = new Map<string, string>();
  for (const { raws, jpegs } of groups.values()) {
    if (raws.length !== 1 || jpegs.length !== 1) continue;
    const [raw] = raws;
    const [jpeg] = jpegs;
    const a = raw.exif?.capturedAtMs;
    const b = jpeg.exif?.capturedAtMs;
    if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) > 2000) continue;
    jpegOf.set(raw.id, jpeg.id);
    rawOf.set(jpeg.id, raw.id);
  }
  return { jpegOf, rawOf };
}

/** These ids plus their pair partners, so one decision or rating covers both files of a shot. */
export function withPartners(ids: readonly string[], pairs: RawJpegPairs): string[] {
  const out = new Set(ids);
  for (const id of ids) {
    const partner = pairs.jpegOf.get(id) ?? pairs.rawOf.get(id);
    if (partner) out.add(partner);
  }
  return [...out];
}
