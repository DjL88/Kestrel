import { applyAutoTag, mayAutoTag, sameName } from './autoTags';
import { STARTER_TAGS } from './subjectTags';
import type { ExifMetadata, PhotoFrame } from './types';

/**
 * Shots taken close together usually show the same animal. When the species model is sure of a name on one photo, a
 * nearby photo whose own best guess is that same name, just less sure, may take it as a suggestion too.
 *
 * Never overstated (product spec): the nearby photo must make the same guess itself, at a fair share (GUESS_FLOOR). A
 * low guess is never lifted ("If low confidence in kingfisher then don't assume"), nor a different species, nor a photo
 * whose subject is disputed or whose name the person turned down. When sure photos nearby disagree, nothing is shared.
 * The name stays an automatic suggestion the person can remove, and it never changes a decision, rating or edit.
 */

/** The share a photo's own guess needs before nearby sure photos may confirm it. */
export const GUESS_FLOOR = 0.6;
/** How far apart two shots may be, by the camera's clock, and still count as the same moment. */
export const NEARBY_MS = 2 * 60_000;

/** A photo's own best species guess that was not sure enough to name it alone. */
export interface SpeciesGuess { name: string; probability: number }

type Frame = Pick<PhotoFrame, 'id'> & Partial<Pick<PhotoFrame, 'removedAt' | 'subjectKind' | 'subjectDisputed' | 'tags' | 'subjectNames' | 'autoTags' |
  'declinedTags' | 'burstGroupId' | 'burstUngrouped' | 'speciesGuess' | 'speciesNearby'>> & { exif?: Pick<ExifMetadata, 'camera' | 'capturedAtMs'> };

/** Keep a guess only when it is worth keeping: a real name and a share at or above the floor. Anything else is dropped. */
export function keepGuess(guess: SpeciesGuess | undefined): SpeciesGuess | undefined {
  if (!guess || !guess.name.trim() || !Number.isFinite(guess.probability)) return undefined;
  return guess.probability >= GUESS_FLOOR && guess.probability <= 1 ? { name: guess.name, probability: guess.probability } : undefined;
}

/** The name a photo is sure of: a name the person chose or kept, or one the model added by itself (not one shared to it). */
function sureName(frame: Frame): string | undefined {
  if (frame.removedAt != null || frame.subjectKind !== 'wildlife' || frame.subjectDisputed || frame.speciesNearby) return undefined;
  // Kind words such as "Bird" are not a species name: they neither confirm nor contradict one.
  return frame.subjectNames?.[0] ?? frame.tags?.find((tag) => !STARTER_TAGS.wildlife.some((word) => sameName(word, tag)));
}

/** Same moment: the same burst, or the same known camera within NEARBY_MS by the capture clock. */
export function sameMoment(a: Frame, b: Frame): boolean {
  if (a.burstGroupId && a.burstGroupId === b.burstGroupId && !a.burstUngrouped && !b.burstUngrouped) return true;
  const camera = a.exif?.camera?.trim();
  if (!camera || camera !== b.exif?.camera?.trim()) return false;
  const at = a.exif?.capturedAtMs, bt = b.exif?.capturedAtMs;
  if (typeof at !== 'number' || typeof bt !== 'number' || !Number.isFinite(at) || !Number.isFinite(bt)) return false;
  return Math.abs(at - bt) <= NEARBY_MS;
}

/**
 * Photos that may now take a name from sure photos nearby. Returns the same array when nothing changes, so callers can
 * skip a state update. Only photos with no name at all are touched.
 */
export function shareNearbySpecies<T extends Frame>(frames: T[]): T[] {
  const sure = frames.map((frame) => ({ frame, name: sureName(frame) })).filter((entry): entry is { frame: T; name: string } => Boolean(entry.name));
  if (!sure.length) return frames;
  let changed = false;
  const next = frames.map((frame) => {
    const guess = keepGuess(frame.speciesGuess);
    if (!guess || frame.removedAt != null || frame.subjectKind !== 'wildlife' || frame.subjectDisputed) return frame;
    // Only a photo with no species name yet (kind words such as "Bird" aside) takes one, never a name the person turned down.
    if (sureName({ ...frame, speciesNearby: false }) || !mayAutoTag(frame, guess.name)) return frame;
    const nearby = sure.filter((entry) => entry.frame.id !== frame.id && sameMoment(frame, entry.frame));
    if (!nearby.length || nearby.some((entry) => !sameName(entry.name, guess.name))) return frame;
    changed = true;
    return { ...frame, ...applyAutoTag(frame, guess.name), speciesNearby: true };
  });
  return changed ? next : frames;
}
