// Pure decisions for the welcome-back slideshow: which photos, how long each shows, and whether it shows at all.
// No DOM, React or providers.

import type { WelcomeState } from './launchWelcome';

/** How long each photo shows, and how long one fades into the next. */
export const SLIDE_MS = 6000;
export const CROSSFADE_MS = 1000;
/** At most this many photos, so what is remembered for the slideshow stays tiny. */
export const SLIDESHOW_LIMIT = 8;
/** Bounds on what is read back from storage: anything larger is not ours, and is ignored. */
const MAX_KEY_LENGTH = 2048;
const MAX_NAME_LENGTH = 500;

/** The parts of a photo the choice needs (a PhotoFrame has them all). */
export type SlideshowFrame = {
  id: string;
  stableKey: string;
  decision: 'unreviewed' | 'keep' | 'reject';
  removedAt?: number | null;
  virtualCopy?: unknown;
};

/**
 * The photos for the slideshow: the ones the photographer flagged (kept), never removed ones, never a virtual copy (it
 * would show the same picture twice), and one per original.
 *
 * Order: the project's own order, the order the photographer sees in the filmstrip, so the slideshow tells the shoot as
 * it happened. When more are flagged than `limit`, they are taken evenly from across the whole shoot (the first always
 * included) rather than only its start, so a long day is represented from dawn to dusk.
 */
export function pickSlideshowPhotos<T extends SlideshowFrame>(frames: readonly T[], limit = SLIDESHOW_LIMIT): T[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const seen = new Set<string>();
  const flagged = frames.filter((frame) => {
    if (frame.decision !== 'keep' || frame.removedAt != null || frame.virtualCopy || seen.has(frame.stableKey)) return false;
    seen.add(frame.stableKey);
    return true;
  });
  const count = Math.floor(limit);
  if (flagged.length <= count) return flagged;
  return Array.from({ length: count }, (_, i) => flagged[Math.floor((i * flagged.length) / count)]);
}

/** Only welcome back (signed in or a returning guest) shows photos, and only when there are some and it is not turned off. */
export function slideshowWanted(input: { state: WelcomeState; off: boolean; slides: number }): boolean {
  return input.state !== 'first' && !input.off && input.slides > 0;
}

/** The next photo. With reduced motion, or a single photo, it stays where it is: one still photo. */
export function nextSlide(current: number, count: number, reducedMotion: boolean): number {
  if (reducedMotion || count <= 1) return current >= 0 && current < count ? current : 0;
  return current + 1 >= count || current < 0 ? 0 : current + 1;
}

/**
 * What is remembered on this device for the slideshow: references to previews InFlight already stored here (the keys
 * of the offline preview cache), never pictures themselves, so it costs a couple of kilobytes at most.
 * `developVersion` says which background-developed picture to look for first.
 */
export type SlideshowSnapshot = { projectId: string; projectName: string; developVersion: number; keys: string[] };

/** Reads a stored snapshot back, or null when it is missing, malformed, oversized or empty. */
export function asSlideshowSnapshot(value: unknown): SlideshowSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.projectId !== 'string' || typeof v.projectName !== 'string' || v.projectName.length > MAX_NAME_LENGTH) return null;
  if (typeof v.developVersion !== 'number' || !Number.isInteger(v.developVersion)) return null;
  if (!Array.isArray(v.keys) || v.keys.length === 0 || v.keys.length > SLIDESHOW_LIMIT) return null;
  if (!v.keys.every((key) => typeof key === 'string' && key.length > 0 && key.length <= MAX_KEY_LENGTH)) return null;
  return { projectId: v.projectId, projectName: v.projectName, developVersion: v.developVersion, keys: [...v.keys] as string[] };
}
