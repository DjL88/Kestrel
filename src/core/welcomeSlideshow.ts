// Pure decisions for the welcome-back slideshow: which photos, how long each shows, and whether it shows at all.
// No DOM, React or providers.

import type { WelcomeState } from './launchWelcome';

/** How long each photo shows, and how long one fades into the next. */
export const SLIDE_MS = 6000;
export const CROSSFADE_MS = 1000;
/** How long before its crossfade the next photo is read and decoded: just in time, never earlier. */
export const PRELOAD_MS = 2000;
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

/** How many of the project's own photos the "pick up where you left off" card shows. */
export const RESUME_THUMBS = 3;

/** The photos on the "pick up" card: flagged ones first (as the slideshow picks them), then the rest in order. */
export function pickResumePhotos<T extends SlideshowFrame>(frames: readonly T[], limit = RESUME_THUMBS): T[] {
  const picked = pickSlideshowPhotos(frames, limit);
  const seen = new Set(picked.map((frame) => frame.stableKey));
  for (const frame of frames) {
    if (picked.length >= limit) break;
    if (frame.removedAt != null || frame.virtualCopy || seen.has(frame.stableKey)) continue;
    seen.add(frame.stableKey);
    picked.push(frame);
  }
  return picked;
}

/** Only welcome back (signed in or a returning guest) shows photos, and only when there are some and it is not turned off. */
export function slideshowWanted(input: { state: WelcomeState; off: boolean; slides: number }): boolean {
  return input.state !== 'first' && !input.off && input.slides > 0;
}

/**
 * The slideshow only belongs next to the project the welcome offers to pick up: when one is remembered and the snapshot
 * is from another project, it is not shown, so the caption and the card never name different projects.
 */
export function slideshowForProject(snapshot: SlideshowSnapshot | null, lastProjectId: string | null): SlideshowSnapshot | null {
  if (!snapshot) return null;
  return lastProjectId === null || snapshot.projectId === lastProjectId ? snapshot : null;
}

/** One prepared picture: which remembered photo it is, and the address it is shown from. */
export type SlideHandle = { index: number; url: string };
/**
 * What to draw: the photo showing, the one coming in (mounted, then fading in on top), which remembered photos could not
 * be read (in order), and whether it has moved on at least once (so position dots only appear for a real slideshow).
 */
export type SlideshowView = { shown: SlideHandle | null; incoming: SlideHandle | null; fading: boolean; missing: number[]; moved: boolean };

/**
 * Runs the slideshow with everything outside injected, so it can be tested without a browser. At most two pictures are
 * ever held: the one showing and the next. The next is prepared only PRELOAD_MS before its crossfade, and the one that
 * has left is released straight after the fade. With reduced motion exactly one picture is prepared. A picture that
 * cannot be prepared is skipped for good; when only one photo is readable it stays still.
 */
export async function runSlideshow(deps: {
  count: number;
  reduced: boolean;
  prepare: (index: number) => Promise<string | null>;
  release: (url: string) => void;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  alive: () => boolean;
  update: (view: SlideshowView) => void;
}): Promise<void> {
  const missing = new Set<number>();
  let moved = false;
  const view = (shown: SlideHandle | null, incoming: SlideHandle | null = null, fading = false) => {
    if (incoming) moved = true;
    deps.update({ shown, incoming, fading, missing: [...missing].sort((a, b) => a - b), moved });
  };
  const find = async (from: number, exclude: number): Promise<SlideHandle | null> => {
    for (let step = 0; step < deps.count; step += 1) {
      const index = (from + step) % deps.count;
      if (index === exclude || missing.has(index)) continue;
      const url = await deps.prepare(index);
      if (!deps.alive()) { if (url) deps.release(url); return null; }
      if (url) return { index, url };
      missing.add(index);
    }
    return null;
  };

  let shown = await find(0, -1);
  if (!deps.alive()) return;
  view(shown);
  if (!shown || deps.reduced) return;
  while (deps.alive()) {
    const started = deps.now();
    await deps.wait(SLIDE_MS - CROSSFADE_MS - PRELOAD_MS);
    if (!deps.alive()) return;
    const next = await find(shown.index + 1, shown.index);
    if (!deps.alive()) return;
    if (!next) { view(shown); return; }
    view(shown, next);
    // At least a frame between mounting the next picture and fading it in, so the fade always runs.
    await deps.wait(Math.max(50, started + SLIDE_MS - CROSSFADE_MS - deps.now()));
    if (!deps.alive()) return;
    view(shown, next, true);
    await deps.wait(CROSSFADE_MS);
    if (!deps.alive()) return;
    deps.release(shown.url);
    shown = next;
    view(shown);
  }
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

/** The position dots: how many photos can be shown, and which of them is showing. */
export function slideshowDots(view: SlideshowView, count: number): { count: number; current: number } {
  const readable = Array.from({ length: count }, (_, i) => i).filter((i) => !view.missing.includes(i));
  return { count: readable.length, current: Math.max(0, readable.indexOf(view.shown?.index ?? -1)) };
}
