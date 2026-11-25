import type { PictureSource } from '../core/pictureSource';
import { isRawPreviewFile } from '../core/rawFormats';
import { shrinkRgb16 } from '../core/master16';
import type { PhotoFrame } from '../core/types';
import { openRaw16Working, type Raw16Working } from './rawMaster16';

/** The longest edge of the 16-bit copy kept for the screen: above the editor's 2200-pixel picture, so a light crop stays sharp. */
export const RAW16_SCREEN_EDGE = 2560;

/**
 * The picture and its histogram come from the 16-bit RAW develop only when what is on screen is InFlight's own develop of
 * that RAW (never the camera's embedded preview, which is a different picture), the original's fingerprint is known, and
 * this device can develop RAW. Otherwise today's 8-bit picture stands, and nothing claims more.
 */
export function raw16Possible(frame: PhotoFrame, shownSource: PictureSource | undefined, decoderAvailable: boolean): boolean {
  return decoderAvailable && !frame.isDemo && isRawPreviewFile(frame.filename)
    && (shownSource === 'raw-review' || shownSource === 'raw-full')
    && /^[a-f0-9]{64}$/.test(frame.originalSha256 ?? '');
}

/** The few photos' 16-bit working copies kept while browsing, so an edit redraws without developing the RAW again. */
export class Raw16WorkingCache {
  private readonly entries = new Map<string, { promise: Promise<Raw16Working | null>; value?: Raw16Working | null }>();

  constructor(private readonly limit = 4) {}

  /** One develop per photo and fingerprint; a failed develop is remembered as null and not retried until the photo changes. */
  get(key: string, open: () => Promise<Raw16Working>): Promise<Raw16Working | null> {
    const known = this.entries.get(key);
    if (known) {
      this.entries.delete(key);
      this.entries.set(key, known);
      return known.promise;
    }
    const entry: { promise: Promise<Raw16Working | null>; value?: Raw16Working | null } = { promise: Promise.resolve(null) };
    entry.promise = open().then((working) => (entry.value = working), () => (entry.value = null));
    this.entries.set(key, entry);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value as string);
    return entry.promise;
  }

  /** The copy if it is already made; undefined while it is being made or was never asked for. */
  ready(key: string): Raw16Working | undefined {
    return this.entries.get(key)?.value ?? undefined;
  }
}

/** Shared by the editor's picture and the histogram, so a photo is developed at 16 bits once. */
export const raw16Workings = new Raw16WorkingCache();

export function raw16Key(frame: PhotoFrame): string {
  return `${frame.stableKey}|${frame.originalSha256 ?? ''}`;
}

/** The kept copy for this photo, made from its original the first time (see openRaw16Working). */
export function raw16WorkingFor(
  frame: PhotoFrame,
  original: () => Promise<Blob | undefined>,
  shown: HTMLImageElement,
  open: typeof openRaw16Working = openRaw16Working,
): Promise<Raw16Working | null> {
  return raw16Workings.get(raw16Key(frame), async () => {
    const blob = await original();
    if (!blob) throw new Error('The original is not connected.');
    return open(blob, frame.filename, shown, RAW16_SCREEN_EDGE, { originalSha256: frame.originalSha256! });
  });
}

const measuring = new WeakMap<Raw16Working, Raw16Working>();
/** A smaller copy for measuring (the histogram), made once per kept copy. */
export function measuringCopy(working: Raw16Working, edge = 512): Raw16Working {
  let small = measuring.get(working);
  if (!small) {
    small = { picture: shrinkRgb16(working.picture, edge), turn: working.turn };
    measuring.set(working, small);
  }
  return small;
}

/**
 * The 16-bit picture replaces the 8-bit one only if it is at least as detailed as what the 8-bit route would show: a tight
 * crop of the kept copy can be smaller, and a softer picture is never swapped in silently.
 */
export function raw16SharpEnough(rendered: { width: number; height: number }, eightBitLongEdge: number): boolean {
  return Math.max(rendered.width, rendered.height) >= Math.floor(eightBitLongEdge * 0.98);
}
