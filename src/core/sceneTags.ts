import { isLowKeyPixels } from './lowKey';
import { decodeVector } from './speciesMatch';
import { LOGIT_SCALE } from './subjectRouter';
import { sunElevation, sunLight, type SunLight } from './sunPosition';
import { laneRevision, type PhotoTag, type TagFacet } from './photoTags';
import { PLACES_LANE } from './places';
import type { ExifMetadata, PhotoFrame } from './types';

/**
 * Scene tags for one photo: light, weather, style and genre. Each comes from whichever witness is best at it:
 * - golden hour, blue hour and night are calculated from the true capture time and GPS position (`sunTags`), never
 *   read from the picture;
 * - black and white, high-key and low-key are measured on the picture's pixels (`pixelStyleTags`);
 * - everything else is the app's CLIP ViT-B/32 comparing the whole picture with curated prompts (`clipSceneTags`),
 *   given only above a threshold measured on an openly licensed set (src/assets/scene/thresholds.json), and only when
 *   the camera data does not contradict it (a "motion blur" at 1/4000 s is not given).
 * Below a threshold, or with a witness missing, there is no tag. Nothing here is a guess.
 */
export const SCENE_LANE = 'scene';
export const SCENE_FACETS: readonly TagFacet[] = ['light', 'weather', 'style', 'genre'];
export const SCENE_REVISION = 'scene-v1';
export const PLACES_REVISION = 'places-v1';
/** The scene lane's revision says whether the image model took part, so photos are looked at again once it can. */
export const sceneRevision = (withModel: boolean) => (withModel ? `${SCENE_REVISION}+clip` : SCENE_REVISION);

/** What still has to be looked at for a photo: its places (only with GPS) and its scene. */
export function sceneTagWork(frame: PhotoFrame, modelAvailable: boolean): { places: boolean; scene: boolean } {
  if (frame.removedAt != null) return { places: false, scene: false };
  const scene = laneRevision(frame, SCENE_LANE);
  return {
    places: Boolean(frame.exif.gps) && laneRevision(frame, PLACES_LANE) !== PLACES_REVISION,
    scene: scene !== sceneRevision(true) && (scene !== sceneRevision(false) || modelAvailable),
  };
}

/** Photos with tagging still to do, the one on screen first, then in capture order. */
export function sceneTagCandidates(frames: PhotoFrame[], onScreen: string | null, modelAvailable: boolean, skipped: ReadonlySet<string>): PhotoFrame[] {
  return frames.filter((frame) => !skipped.has(frame.id) && Object.values(sceneTagWork(frame, modelAvailable)).some(Boolean))
    .sort((a, b) => Number(b.id === onScreen) - Number(a.id === onScreen) || a.sequenceIndex - b.sequenceIndex);
}

export interface SceneVectorFile {
  dim: number;
  labelsVersion: number;
  tags: Record<string, { for: { v: string; scale: number }; against: { v: string; scale: number } }>;
}
export interface SceneThresholdFile {
  labelsVersion: number;
  tags: Record<string, { threshold: number | null }>;
}
export interface SceneLabel { id: string; facet: TagFacet }
export interface SceneModel { labels: SceneLabel[]; for: Float32Array[]; against: Float32Array[]; thresholds: (number | null)[]; revision: string }

const FACETS = new Set<TagFacet>(SCENE_FACETS);

/** The committed vectors and thresholds, checked against each other. Throws on any mismatch. */
export function sceneModel(labels: { version: number; tags: { id: string; facet: string }[] }, vectors: SceneVectorFile, thresholds: SceneThresholdFile): SceneModel {
  if (vectors.labelsVersion !== labels.version || thresholds.labelsVersion !== labels.version) {
    throw new RangeError('Scene tag vectors or thresholds are out of date with the labels.');
  }
  const model: SceneModel = { labels: [], for: [], against: [], thresholds: [], revision: `scene-v${labels.version}` };
  for (const tag of labels.tags) {
    const entry = vectors.tags[tag.id];
    if (!entry || !FACETS.has(tag.facet as TagFacet)) throw new RangeError(`No usable vector for scene tag ${tag.id}.`);
    const up = decodeVector({ vector: entry.for.v, scale: entry.for.scale });
    const down = decodeVector({ vector: entry.against.v, scale: entry.against.scale });
    if (up.length !== vectors.dim || down.length !== vectors.dim) throw new RangeError(`Scene tag ${tag.id} has the wrong length.`);
    const threshold = thresholds.tags[tag.id]?.threshold;
    model.labels.push({ id: tag.id, facet: tag.facet as TagFacet });
    model.for.push(up);
    model.against.push(down);
    model.thresholds.push(typeof threshold === 'number' && threshold > 0 && threshold < 1 ? threshold : null);
  }
  return model;
}

const dot = (a: Float32Array, b: Float32Array) => { let sum = 0; for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i]; return sum; };

/** How strongly the picture matches a tag's prompts rather than its "against" prompts, 0 to 1. Same as the measuring tool. */
export function sceneScore(embedding: Float32Array, up: Float32Array, down: Float32Array): number {
  return 1 / (1 + Math.exp(-LOGIT_SCALE * (dot(embedding, up) - dot(embedding, down))));
}

/** The sun's light at capture, only with a true UTC instant and a GPS position. */
export function captureSunLight(exif: Pick<ExifMetadata, 'gps' | 'capturedAtUtcMs'>): SunLight | undefined {
  if (!exif.gps || typeof exif.capturedAtUtcMs !== 'number' || !Number.isFinite(exif.capturedAtUtcMs)) return undefined;
  return sunLight(sunElevation(exif.capturedAtUtcMs, exif.gps.latitude, exif.gps.longitude));
}

export function sunTags(exif: Pick<ExifMetadata, 'gps' | 'capturedAtUtcMs'>): PhotoTag[] {
  const light = captureSunLight(exif);
  if (light === 'golden-hour' || light === 'blue-hour' || light === 'night') return [{ id: `light.${light}`, facet: 'light', source: 'computed' }];
  return [];
}

/** What the camera data rules out. Unknown camera data rules nothing out. */
function contradicted(id: string, exif: Pick<ExifMetadata, 'exposureSeconds' | 'apertureF' | 'focalLengthMm'>, sun: SunLight | undefined): boolean {
  const exposure = exif.exposureSeconds;
  const daylight = sun === 'day' || sun === 'golden-hour';
  switch (id) {
    case 'style.motion-blur': return exposure !== undefined && exposure < 1 / 60;
    case 'style.panning-blur': return exposure !== undefined && exposure < 1 / 400;
    case 'style.shallow-dof': return exif.apertureF !== undefined && exif.apertureF > 5.6 && !((exif.focalLengthMm ?? 0) >= 300);
    case 'light.milky-way': return daylight || (exposure !== undefined && exposure < 1);
    case 'genre.astro': return daylight;
    case 'weather.clear': case 'weather.overcast': return sun === 'night';
    default: return false;
  }
}

/** Tags of which only the strongest may stand, because they cannot both be true of one sky. */
const EXCLUSIVE: readonly (readonly string[])[] = [['weather.clear', 'weather.overcast'], ['weather.clear', 'weather.fog'], ['weather.clear', 'weather.rain']];

export function clipSceneTags(
  embedding: Float32Array, model: SceneModel, exif: Pick<ExifMetadata, 'exposureSeconds' | 'apertureF' | 'focalLengthMm' | 'gps' | 'capturedAtUtcMs'>,
): PhotoTag[] {
  const sun = captureSunLight(exif);
  const passed: PhotoTag[] = [];
  model.labels.forEach((label, index) => {
    const threshold = model.thresholds[index];
    if (threshold === null) return;
    const score = sceneScore(embedding, model.for[index], model.against[index]);
    if (score >= threshold && !contradicted(label.id, exif, sun)) passed.push({ id: label.id, facet: label.facet, source: 'clip', score });
  });
  return passed.filter((tag) => !EXCLUSIVE.some((pair) => pair.includes(tag.id) &&
    passed.some((other) => other !== tag && pair.includes(other.id) && (other.score ?? 0) > (tag.score ?? 0))));
}

/**
 * Black and white, high-key and low-key, measured on RGBA pixels (any size; sampled). Black and white: almost no colour
 * anywhere (a toned print counts if it has one hue only weakly). High-key: mostly bright with few dark tones. Low-key:
 * the same rule Suggest a look uses (`lowKey.ts`): mostly very dark with a clearly lit area.
 */
export function pixelStyleTags(rgba: Uint8ClampedArray): PhotoTag[] {
  const count = rgba.length / 4;
  if (count < 64) return [];
  const stride = Math.max(1, Math.floor(count / 40_000));
  const tones: number[] = [];
  const chroma: number[] = [];
  for (let i = 0; i < count; i += stride) {
    const j = i * 4;
    const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
    tones.push((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
    chroma.push((Math.max(r, g, b) - Math.min(r, g, b)) / 255);
  }
  tones.sort((a, b) => a - b);
  chroma.sort((a, b) => a - b);
  const at = (list: number[], q: number) => list[Math.min(list.length - 1, Math.floor(q * list.length))];
  const tags: PhotoTag[] = [];
  if (at(chroma, 0.99) <= 0.06) tags.push({ id: 'style.black-and-white', facet: 'style', source: 'computed' });
  if (at(tones, 0.5) >= 0.7 && at(tones, 0.05) >= 0.35) tags.push({ id: 'style.high-key', facet: 'style', source: 'computed' });
  else if (isLowKeyPixels(rgba)) tags.push({ id: 'style.low-key', facet: 'style', source: 'computed' });
  return tags;
}

/** All scene tags for one photo, from whatever witnesses are available. `embedding` null: the image model could not run. */
export function sceneTags(input: { exif: ExifMetadata; rgba?: Uint8ClampedArray | null; embedding?: Float32Array | null; model?: SceneModel | null }): PhotoTag[] {
  const tags = [...sunTags(input.exif)];
  if (input.rgba) tags.push(...pixelStyleTags(input.rgba));
  if (input.embedding && input.model) {
    for (const tag of clipSceneTags(input.embedding, input.model, input.exif)) {
      // A calculated night or measured black and white outranks the model's reading of the same thing.
      if (!tags.some((other) => other.id === tag.id)) tags.push(tag);
    }
  }
  return tags;
}
