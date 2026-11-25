import { centreSquare } from '../core/speciesModel';
import { curatedTags, placeTags, readPlaceTable, type CuratedSpot, type PlaceTable } from '../core/places';
import { sceneModel, sceneTags, type SceneModel } from '../core/sceneTags';
import type { PhotoTag } from '../core/photoTags';
import type { PhotoFrame } from '../core/types';
import { embedSquare, gateAvailable } from './categoryGate';

/**
 * Works out a photo's scene and place tags on this device. No network: the place table is one of the app's own files,
 * and the image model is the category gate's CLIP (in the browser, only once the person has downloaded it). Without
 * the image model, the calculated and measured tags (golden hour, black and white…) are still given.
 */
export const PLACE_TABLE_URL = '/places/geonames-cities1000.bin';

let model: Promise<SceneModel> | null = null;
function loadSceneModel(): Promise<SceneModel> {
  model ??= Promise.all([
    import('../assets/scene/labels.json'), import('../assets/scene/vectors.json'), import('../assets/scene/thresholds.json'),
  ]).then(([labels, vectors, thresholds]) => sceneModel(labels.default, vectors.default, thresholds.default));
  return model;
}

let table: Promise<{ places: PlaceTable; spots: CuratedSpot[] } | null> | null = null;
/** The place table, read once. A missing or damaged file means no place tags this session, never a wrong one. */
export function loadPlaces(): Promise<{ places: PlaceTable; spots: CuratedSpot[] } | null> {
  table ??= (async () => {
    try {
      const [response, curated] = await Promise.all([fetch(PLACE_TABLE_URL), import('../assets/places/curated.json')]);
      if (!response.ok) return null;
      return { places: readPlaceTable(await response.arrayBuffer()), spots: curated.default.spots };
    } catch (error) {
      console.warn('Place names are not available', error);
      return null;
    }
  })();
  return table;
}

/** Place and photo-spot tags for a photo with GPS, or null when the table could not be read. */
export async function placeTagsFor(frame: Pick<PhotoFrame, 'exif'>): Promise<PhotoTag[] | null> {
  const gps = frame.exif.gps;
  if (!gps) return [];
  const loaded = await loadPlaces();
  if (!loaded) return null;
  return [...curatedTags(loaded.spots, gps.latitude, gps.longitude), ...placeTags(loaded.places, gps.latitude, gps.longitude)];
}

/**
 * Scene tags for a photo from its small analysis picture, whether the image model took part, and the picture vector it
 * worked out (kept for search in words; null without the model).
 */
export async function sceneTagsFor(frame: Pick<PhotoFrame, 'exif'>, picture: HTMLCanvasElement): Promise<{ tags: PhotoTag[]; withModel: boolean; vector: Float32Array | null }> {
  const context = picture.getContext('2d', { willReadFrequently: true });
  const rgba = context ? context.getImageData(0, 0, picture.width, picture.height).data : null;
  let embedding: Float32Array | null = null;
  let scene: SceneModel | null = null;
  if (await gateAvailable().catch(() => false)) {
    try {
      [scene, embedding] = await Promise.all([loadSceneModel(), embedSquare(picture, centreSquare(picture.width, picture.height))]);
    } catch (error) {
      console.warn('Scene tags: the image model could not run', error);
      scene = null; embedding = null;
    }
  }
  return { tags: sceneTags({ exif: frame.exif, rgba, embedding, model: scene }), withModel: Boolean(embedding && scene), vector: embedding && scene ? embedding : null };
}
