import { hasPhotoTag, photoTagsOf } from './photoTags';
import type { PhotoFrame } from './types';

/**
 * What the photo's scene tags (src/core/photoTags.ts) ask Auto-Edit to leave alone. Hints, never overrides: each one can
 * only remove or soften a measured suggestion, never add an adjustment, so a wrong tag costs at most a missed edit.
 * The vision guardian still has the last word and can only hold a result back.
 */
export interface SceneHints {
  /** Golden or blue hour: keep the warm or blue cast; do not neutralise it towards daylight. */
  preserveLight?: boolean;
  /** Low-key, night, astro, Milky Way: do not lift shadows or brighten towards a "normal" histogram. */
  preserveDark?: boolean;
  /**
   * `preserveDark` came only from InFlight's own pixel measurement of "low-key" (a `computed` style.low-key tag), not from
   * the person, the camera clock or the image model. Natural Auto measures the same thing itself, so on a frame it also
   * measures as low-key it still lifts a dim subject (the dark background is kept and the render check proves it).
   * Anything else that says dark on purpose (the person's own tag, night, astro) stays a hard hold.
   */
  darkMeasuredOnly?: boolean;
  /** Fog: no added contrast or crispness by default. */
  preserveSoft?: boolean;
  /** Snow, high-key: do not darken a bright frame or pull its highlights grey. */
  preserveBright?: boolean;
  /** Black and white: skip colour-only suggestions (vibrance, warmth). */
  monochrome?: boolean;
  /** Overcast: soft, cool light is real; keep any added contrast gentle and add no warming. */
  overcast?: boolean;
}

const HINTS: readonly [keyof SceneHints, readonly string[]][] = [
  ['preserveLight', ['light.golden-hour', 'light.blue-hour']],
  ['preserveDark', ['style.low-key', 'light.night', 'genre.astro', 'light.milky-way']],
  ['preserveSoft', ['weather.fog']],
  ['preserveBright', ['weather.snow', 'style.high-key']],
  ['monochrome', ['style.black-and-white']],
  ['overcast', ['weather.overcast']],
];

const DARK_IDS = HINTS.find(([hint]) => hint === 'preserveDark')![1];

export function sceneHintsFromPhotoTags(frame: Pick<PhotoFrame, 'stableKey' | 'photoTags'>): SceneHints {
  const hints: SceneHints = {};
  for (const [hint, ids] of HINTS) if (ids.some((id) => hasPhotoTag(frame, id))) hints[hint] = true;
  if (hints.preserveDark) {
    const dark = photoTagsOf(frame).filter((tag) => DARK_IDS.includes(tag.id));
    if (dark.length && dark.every((tag) => tag.id === 'style.low-key' && tag.source === 'computed')) hints.darkMeasuredOnly = true;
  }
  return hints;
}
