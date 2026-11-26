import type { ExifMetadata, PhotoFrame } from './types';

/**
 * Exposure brackets from the camera's own settings: runs of photos taken in quick succession with the same camera,
 * size and focal length but deliberately different exposures, so the editor can offer an HDR merge of them.
 *
 * Read from standard EXIF only: Exposure mode "Auto bracket" when the camera wrote it, exposure compensation, and
 * the exposure itself (shutter, aperture, ISO). A camera's own in-camera HDR mode already saves one merged JPEG and is
 * not a bracket here. A suggestion only: nothing is merged, chosen or changed until the person asks.
 */

export interface ExposureBracket {
  /** Frame ids in shooting order. */
  frameIds: string[];
  /** Each frame's exposure in stops against the middle one (0), from its EXIF, to the nearest third of a stop. */
  ev: number[];
  /** The camera marked these as an automatic exposure bracket. */
  fromCamera: boolean;
}

/** Longest gap between frames of one bracket. Cameras fire a bracket in well under a second per frame. */
const MAX_GAP_MS = 2500;
const MAX_FRAMES = 7;

/** The exposure the camera gave this frame, in stops (bigger is brighter), or null when the file does not say. */
export function exposureStops(exif: ExifMetadata): number | null {
  const t = exif.exposureSeconds, n = exif.apertureF, iso = exif.iso;
  if (t && t > 0 && n && n > 0 && iso && iso > 0) return Math.log2(t) - 2 * Math.log2(n) + Math.log2(iso / 100);
  if (typeof exif.exposureBiasEv === 'number' && Number.isFinite(exif.exposureBiasEv)) return exif.exposureBiasEv;
  return null;
}

function sameSetup(a: ExifMetadata, b: ExifMetadata): boolean {
  if ((a.camera ?? '') !== (b.camera ?? '')) return false;
  if (a.width && b.width && (a.width !== b.width || a.height !== b.height)) return false;
  const fa = a.focalLengthMm, fb = b.focalLengthMm;
  if (fa && fb && Math.abs(fa - fb) > Math.max(fa, fb) * 0.02) return false;
  return true;
}

function finish(run: Array<{ frame: PhotoFrame; stops: number }>, out: ExposureBracket[]): void {
  if (run.length < 2) return;
  const fromCamera = run.every(({ frame }) => frame.exif?.autoBracket === true);
  const stops = run.map((r) => r.stops);
  const spread = Math.max(...stops) - Math.min(...stops);
  // Without the camera's bracket mark, ask for a clear deliberate spread, so an ordinary burst whose auto exposure
  // drifted is never called a bracket.
  if (!fromCamera && (spread < 1 || run.some((r, i) => i > 0 && Math.abs(r.stops - run[i - 1].stops) < 0.3))) return;
  if (fromCamera && spread < 0.3) return;
  const middle = [...stops].sort((a, b) => a - b)[(stops.length - 1) >> 1];
  out.push({ frameIds: run.map((r) => r.frame.id), // Nominal shutter speeds (1/30, 1/125) are not exact powers of two: label to the nearest third of a stop.
    ev: stops.map((s) => Math.round(Math.round((s - middle) * 3) / 3 * 10) / 10), fromCamera });
}

/** Every bracket in the project's photos (removed and demo photos left out). */
export function findExposureBrackets(frames: readonly PhotoFrame[]): ExposureBracket[] {
  const usable = frames
    .filter((frame) => !frame.removedAt && !frame.isDemo && frame.exif && typeof frame.exif.capturedAtMs === 'number')
    .map((frame) => ({ frame, stops: exposureStops(frame.exif) }))
    .filter((item): item is { frame: PhotoFrame; stops: number } => item.stops !== null)
    .sort((a, b) => (a.frame.exif.capturedAtMs! - b.frame.exif.capturedAtMs!) || a.frame.sequenceIndex - b.frame.sequenceIndex);
  const out: ExposureBracket[] = [];
  let run: typeof usable = [];
  for (const item of usable) {
    const last = run[run.length - 1];
    const joins = last && item.frame.exif.capturedAtMs! - last.frame.exif.capturedAtMs! <= MAX_GAP_MS && sameSetup(last.frame.exif, item.frame.exif)
      // A repeated exposure starts the next bracket (continuous bracketing: 0, −2, +2, 0, −2, +2).
      && !run.some((r) => Math.abs(r.stops - item.stops) < 0.15) && run.length < MAX_FRAMES;
    if (!joins) { finish(run, out); run = []; }
    run.push(item);
  }
  finish(run, out);
  return out;
}

/** frame id → its bracket, for the photo list. */
export function bracketsByFrame(frames: readonly PhotoFrame[]): Map<string, ExposureBracket> {
  const map = new Map<string, ExposureBracket>();
  for (const bracket of findExposureBrackets(frames)) for (const id of bracket.frameIds) map.set(id, bracket);
  return map;
}
