import { hasPhotoTag } from './photoTags';
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
  /** Fog: no added contrast or crispness by default. */
  preserveSoft?: boolean;
  /** Snow, high-key: do not darken a bright frame or pull its highlights grey. */
  preserveBright?: boolean;
  /** Black and white: skip colour-only suggestions (vibrance, warmth). */
  monochrome?: boolean;
}

const HINTS: readonly [keyof SceneHints, readonly string[]][] = [
  ['preserveLight', ['light.golden-hour', 'light.blue-hour']],
  ['preserveDark', ['style.low-key', 'light.night', 'genre.astro', 'light.milky-way']],
  ['preserveSoft', ['weather.fog']],
  ['preserveBright', ['weather.snow', 'style.high-key']],
  ['monochrome', ['style.black-and-white']],
];

export function sceneHintsFromPhotoTags(frame: Pick<PhotoFrame, 'stableKey' | 'photoTags'>): SceneHints {
  const hints: SceneHints = {};
  for (const [hint, ids] of HINTS) if (ids.some((id) => hasPhotoTag(frame, id))) hints[hint] = true;
  return hints;
}
