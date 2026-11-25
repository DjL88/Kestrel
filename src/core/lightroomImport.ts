/**
 * Match a Lightroom Classic catalogue's photos to the photos in an InFlight project, never guessing.
 *
 * A catalogue photo matches a project photo only when:
 *  - its full path equals the project photo's path on disk (desktop app), or
 *  - its file name is unique in both the catalogue and the project, and, where both know when it was taken, the two
 *    capture times agree (allowing a whole time-zone offset, since Lightroom stores local time without a zone). When the
 *    project photo has a path on disk that differs from the catalogue's (moved files, another drive), both capture times
 *    must be known and agree.
 * Anything else (same name twice, a different capture time, a virtual copy) is left alone and counted, so the person is
 * told how many were not brought in and why. Nothing here changes a photo; it only plans.
 */
import type { LightroomPhoto } from './lightroomCatalogue';
import type { PhotoFrame } from './types';

export interface LightroomMatch { frameId: string; photo: LightroomPhoto }
export interface LightroomPlan {
  matches: LightroomMatch[];
  /** Catalogue photos (not virtual copies) with no safe match here. */
  unmatched: number;
  /** Catalogue photos whose name appears more than once (in the catalogue or the project), so they were not guessed. */
  ambiguous: number;
  /** Same name, but taken at a different time: a different photo, so left alone. */
  differentTime: number;
  virtualCopies: number;
}

const normalisePath = (path: string) => path.replace(/\\/g, '/').normalize('NFC').toLowerCase();
const normaliseName = (name: string) => name.normalize('NFC').toLowerCase();

export function planLightroomImport(photos: readonly LightroomPhoto[], frames: readonly PhotoFrame[]): LightroomPlan {
  const live = frames.filter((frame) => !frame.isDemo && !frame.virtualCopy && frame.removedAt == null);
  const byPath = new Map<string, PhotoFrame>();
  const byName = new Map<string, PhotoFrame | null>();
  for (const frame of live) {
    if (frame.sourcePath) byPath.set(normalisePath(frame.sourcePath), frame);
    const key = normaliseName(frame.filename);
    byName.set(key, byName.has(key) ? null : frame);
  }
  const originals = photos.filter((photo) => !photo.virtualCopy);
  const nameCount = new Map<string, number>();
  for (const photo of originals) {
    const key = normaliseName(photo.filename);
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1);
  }

  const plan: LightroomPlan = { matches: [], unmatched: 0, ambiguous: 0, differentTime: 0, virtualCopies: photos.length - originals.length };
  const used = new Set<string>();
  for (const photo of originals) {
    let frame = byPath.get(normalisePath(photo.path));
    if (!frame) {
      const key = normaliseName(photo.filename);
      const candidate = byName.get(key);
      if (candidate === undefined) { plan.unmatched++; continue; }
      if (candidate === null || (nameCount.get(key) ?? 0) > 1) { plan.ambiguous++; plan.unmatched++; continue; }
      // The paths differ (the photos moved, or another drive): the name alone is then not enough; both capture times
      // must be known and agree.
      if (candidate.sourcePath && (!photo.captureTime || candidate.exif?.capturedAtMs == null)) {
        plan.unmatched++;
        continue;
      }
      frame = candidate;
    }
    if (!sameCaptureTime(photo.captureTime, frame.exif?.capturedAtMs)) { plan.differentTime++; plan.unmatched++; continue; }
    if (used.has(frame.id)) { plan.ambiguous++; plan.unmatched++; continue; }
    used.add(frame.id);
    plan.matches.push({ frameId: frame.id, photo });
  }
  return plan;
}

/**
 * Lightroom writes capture time as local wall-clock time ("2024-05-01T10:20:30.12"), sometimes with an offset. InFlight
 * may hold it as an instant. Agree when within two seconds, or within two seconds of a whole quarter-hour offset up to
 * 14 hours (a time-zone difference). Unknown on either side is not evidence against a match.
 */
export function sameCaptureTime(captureTime: string | undefined, capturedAtMs: number | undefined): boolean {
  if (!captureTime || capturedAtMs == null || !Number.isFinite(capturedAtMs)) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(captureTime);
  if (!match) return true;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const lightroom = Date.UTC(y, mo - 1, d, h, mi, s);
  const diff = Math.abs(lightroom - capturedAtMs) / 1000;
  if (diff <= 2) return true;
  if (diff > 14 * 3600 + 2) return false;
  const off = diff % 900;
  return off <= 2 || off >= 898;
}
