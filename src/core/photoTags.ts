import type { PhotoFrame } from './types';

/**
 * One shared store for the plain-language tags InFlight works out for a photo by itself: places and landmarks, light,
 * weather, style, genre (this lane) and vehicles, aircraft, motorsport and ships (the vehicles lane). Pure and
 * offline. Rules every lane keeps:
 * - Below a measured threshold there is no tag. Nothing here is a guess or "maybe".
 * - Each lane writes only its own tags (`mergePhotoTags`), so two lanes never overwrite each other.
 * - A tag the person removed (`declinePhotoTag`) is never added to that photo again, by any lane.
 * - The words people see come from the `photoTags` i18n area by `id`; `name` is only for proper nouns (a place, an
 *   aircraft type) that are never translated.
 * - Place and landmark tags are location, which is personal: `withoutLocation` takes them out of anything that leaves
 *   the device (backups), together with the GPS position.
 */
export type TagFacet = 'place' | 'landmark' | 'light' | 'weather' | 'style' | 'genre' | 'vehicle';
export const TAG_FACETS: readonly TagFacet[] = ['place', 'landmark', 'light', 'weather', 'style', 'genre', 'vehicle'];
/** Where a tag came from: the photo's GPS, its camera data, a measurement or calculation, the image model, or a curated list. */
export type TagSource = 'gps' | 'exif' | 'computed' | 'clip' | 'curated';

export interface PhotoTag {
  /** Stable dotted key, e.g. `light.golden-hour`, `place.gn.2643743`, `vehicle.helicopter`. Also the i18n key. */
  id: string;
  facet: TagFacet;
  source: TagSource;
  /** How strongly the evidence passed its threshold (0 to 1), when there is a score. Never shown as a number. */
  score?: number;
  /** A proper noun shown as it is in every language (a place name, an aircraft type). */
  name?: string;
}

export interface PhotoTagSet {
  schema: 1;
  /** The photo these tags were worked out for; tags for an older file at the same place are ignored. */
  sourceStableKey: string;
  tags: PhotoTag[];
  /** Tag ids the person removed from this photo. */
  declined: string[];
  /** Which version of each lane's rules or models produced its tags, when, and which tags are that lane's. */
  byLane: Record<string, { revision: string; at: number; ids: string[] }>;
}

const ID = /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,4}$/;
const MAX_TAGS = 64;
const MAX_DECLINED = 256;
const LOCATION: ReadonlySet<TagFacet> = new Set(['place', 'landmark']);

export const isTagId = (id: unknown): id is string => typeof id === 'string' && id.length <= 96 && ID.test(id);

/** The photo's tags, or none when they are missing, malformed or belong to a different file. */
export function readPhotoTags(frame: Pick<PhotoFrame, 'stableKey' | 'photoTags'>): PhotoTagSet | null {
  const set = frame.photoTags;
  if (!set || set.schema !== 1 || set.sourceStableKey !== frame.stableKey || !Array.isArray(set.tags)) return null;
  return set;
}

function cleanTag(tag: PhotoTag): PhotoTag | null {
  if (!tag || !isTagId(tag.id) || !TAG_FACETS.includes(tag.facet) ||
      !['gps', 'exif', 'computed', 'clip', 'curated'].includes(tag.source)) return null;
  const out: PhotoTag = { id: tag.id, facet: tag.facet, source: tag.source };
  if (typeof tag.score === 'number' && Number.isFinite(tag.score)) out.score = Math.min(1, Math.max(0, Math.round(tag.score * 1000) / 1000));
  if (typeof tag.name === 'string') {
    const name = tag.name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (name) out.name = name;
  }
  return out;
}

/** The tag ids that belong to a lane, so a lane's re-run replaces only its own tags. */
const laneOf = (set: PhotoTagSet | null, id: string) => Object.entries(set?.byLane ?? {}).find(([, value]) => Array.isArray(value?.ids) && value.ids.includes(id))?.[0];

/**
 * Replace one lane's tags for the given facets with `tags`. Other lanes' tags, and this lane's tags in other facets,
 * stay. Declined ids are never added. Returns the frame unchanged when nothing would change.
 */
export function mergePhotoTags<F extends Pick<PhotoFrame, 'stableKey' | 'photoTags' | 'removedAt'>>(
  frame: F, lane: string, facets: readonly TagFacet[], tags: readonly PhotoTag[], revision: string, at = Date.now(),
): F {
  if (frame.removedAt != null || !frame.stableKey || !/^[a-z][a-z0-9-]{0,31}$/.test(lane) || !revision.trim()) return frame;
  const current = readPhotoTags(frame);
  const declined = new Set(current?.declined ?? []);
  const laneIds = current?.byLane[lane]?.ids;
  const owned = new Set(Array.isArray(laneIds) ? laneIds : []);
  const kept = (current?.tags ?? []).filter((tag) => !(owned.has(tag.id) && facets.includes(tag.facet)));
  const keptIds = new Set(kept.map((tag) => tag.id));
  const added: PhotoTag[] = [];
  for (const raw of tags) {
    const tag = cleanTag(raw);
    if (!tag || !facets.includes(tag.facet) || declined.has(tag.id) || keptIds.has(tag.id)) continue;
    // A tag another lane already gave stays that lane's.
    const ownerLane = laneOf(current, tag.id);
    if (ownerLane && ownerLane !== lane) continue;
    keptIds.add(tag.id);
    added.push(tag);
  }
  const next = [...kept, ...added].slice(0, MAX_TAGS);
  const ids = next.filter((tag) => (owned.has(tag.id) && !facets.includes(tag.facet)) || added.includes(tag)).map((tag) => tag.id);
  const byLane = { ...(current?.byLane ?? {}), [lane]: { revision: revision.slice(0, 80), at, ids } };
  const set: PhotoTagSet = { schema: 1, sourceStableKey: frame.stableKey, tags: next, declined: [...declined], byLane };
  if (current && JSON.stringify(current.tags) === JSON.stringify(set.tags) &&
      current.byLane[lane]?.revision === set.byLane[lane].revision) return frame;
  return { ...frame, photoTags: set };
}

/** The person removed a tag: it goes, and no lane adds it to this photo again. */
export function declinePhotoTag<F extends Pick<PhotoFrame, 'stableKey' | 'photoTags'>>(frame: F, id: string): F {
  const current = readPhotoTags(frame);
  if (!current || !isTagId(id)) return frame;
  const declined = current.declined.includes(id) ? current.declined : [...current.declined, id].slice(-MAX_DECLINED);
  return { ...frame, photoTags: { ...current, tags: current.tags.filter((tag) => tag.id !== id), declined } };
}

/** Every tag of a photo, optionally of one facet. */
export function photoTagsOf(frame: Pick<PhotoFrame, 'stableKey' | 'photoTags'>, facet?: TagFacet): PhotoTag[] {
  const tags = readPhotoTags(frame)?.tags ?? [];
  return facet ? tags.filter((tag) => tag.facet === facet) : tags;
}

export const hasPhotoTag = (frame: Pick<PhotoFrame, 'stableKey' | 'photoTags'>, id: string) => photoTagsOf(frame).some((tag) => tag.id === id);

/**
 * The words shown for a tag: a proper noun as it is, otherwise the translated word for its id. `label` returns
 * undefined for an id it has no words for, and then the tag is not shown (never a raw id).
 */
export function tagWords(tag: PhotoTag, label: (id: string) => string | undefined): string | undefined {
  return tag.name ?? label(tag.id);
}

/**
 * What the tags add to search: the words in the person's language and in British English, so "golden hour" and
 * "heure dorée" both find the photo.
 */
export function photoTagSearchWords(
  frame: Pick<PhotoFrame, 'stableKey' | 'photoTags'>, localLabel: (id: string) => string | undefined, englishLabel: (id: string) => string | undefined,
): string[] {
  const words = new Set<string>();
  for (const tag of photoTagsOf(frame)) {
    for (const word of [tagWords(tag, localLabel), tagWords(tag, englishLabel)]) if (word) words.add(word);
  }
  return [...words];
}

/** A copy of the frame for anything that leaves the device: no GPS position and no place or landmark tags. */
export function withoutLocation<F extends Pick<PhotoFrame, 'exif' | 'photoTags'>>(frame: F): F {
  // A malformed restore may lack EXIF; that is left for the caller's own checks.
  const exif = frame.exif && typeof frame.exif === 'object' ? (({ gps: _gps, ...rest }) => rest)(frame.exif) : frame.exif;
  const set = frame.photoTags;
  if (!set || typeof set !== 'object') return { ...frame, exif };
  const tags = Array.isArray(set.tags) ? set.tags.filter((tag) => !LOCATION.has(tag?.facet)) : [];
  return { ...frame, exif, photoTags: { ...set, tags } };
}

/** The revision a lane last wrote for this photo, or undefined when it has not looked at it yet. */
export function laneRevision(frame: Pick<PhotoFrame, 'stableKey' | 'photoTags'>, lane: string): string | undefined {
  const revision = readPhotoTags(frame)?.byLane[lane]?.revision;
  return typeof revision === 'string' ? revision : undefined;
}
