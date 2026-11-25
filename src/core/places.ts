import type { PhotoTag } from './photoTags';

/**
 * Where a photo was taken, in words, worked out on this device from its GPS position. No network.
 * - Place, region and country come from GeoNames (CC BY 4.0, `public/places/geonames-cities1000.bin`, built by
 *   tools/scene-tags/make_places.py): the nearest populated place of 1,000 people or more.
 * - Well-known photo spots (the Mach Loop's Cad West and the Bwlch) come from a small curated list
 *   (src/assets/places/curated.json), each with the radius it covers.
 * A place further away than it can honestly be called "at" gets no tag; out at sea there is none.
 */
export const PLACES_LANE = 'places';
/** Nearest place within this distance names the photo's place. */
export const PLACE_RADIUS_KM = 10;
/** Region and country are named only if some place is at least this close (not far out at sea). */
export const REGION_RADIUS_KM = 40;

export interface PlaceTable {
  latitude: Int32Array;
  longitude: Int32Array;
  id: Uint32Array;
  region: Uint16Array;
  regions: { country: string; name: string }[];
  names: string[];
  /** Index by whole-degree cell: "lat,lon" → row numbers. */
  cells: Map<string, number[]>;
}

/** Read the table file. Throws on anything malformed, so a damaged file is never half-used. */
export function readPlaceTable(buffer: ArrayBuffer): PlaceTable {
  const view = new DataView(buffer);
  if (buffer.byteLength < 12 || String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== 'KGN1') {
    throw new RangeError('Not a place-name table.');
  }
  const count = view.getUint32(4, true);
  const regionCount = view.getUint32(8, true);
  let offset = 12;
  const take = <T>(make: (start: number) => T, bytes: number): T => {
    if (offset + bytes > buffer.byteLength) throw new RangeError('Place-name table is cut short.');
    const value = make(offset);
    offset += bytes;
    return value;
  };
  // Copy each column so it is aligned whatever the file's layout.
  const latitude = take((at) => new Int32Array(buffer.slice(at, at + count * 4)), count * 4);
  const longitude = take((at) => new Int32Array(buffer.slice(at, at + count * 4)), count * 4);
  const id = take((at) => new Uint32Array(buffer.slice(at, at + count * 4)), count * 4);
  const region = take((at) => new Uint16Array(buffer.slice(at, at + count * 2)), count * 2);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const block = () => {
    const length = take((at) => view.getUint32(at, true), 4);
    return take((at) => decoder.decode(new Uint8Array(buffer, at, length)), length).split('\n');
  };
  const regions = block().map((line) => { const [country, name = ''] = line.split('\t'); return { country, name }; });
  const names = block();
  if (regions.length !== regionCount || names.length !== count) throw new RangeError('Place-name table does not add up.');
  const cells = new Map<string, number[]>();
  for (let row = 0; row < count; row += 1) {
    if (region[row] >= regionCount) throw new RangeError('Place-name table has a bad region.');
    const key = `${Math.floor(latitude[row] / 1e5)},${Math.floor(longitude[row] / 1e5)}`;
    const list = cells.get(key);
    if (list) list.push(row); else cells.set(key, [row]);
  }
  return { latitude, longitude, id, region, regions, names, cells };
}

const RAD = Math.PI / 180;
/** Great-circle distance in kilometres. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface NearestPlace { row: number; km: number }

/** The nearest place within `limitKm`, or null. Looks at the surrounding whole-degree cells. */
export function nearestPlace(table: PlaceTable, latitude: number, longitude: number, limitKm = REGION_RADIUS_KM): NearestPlace | null {
  const cellLat = Math.floor(latitude), cellLon = Math.floor(longitude);
  // One degree of latitude is 111 km; of longitude, less towards the poles, so look further east and west there.
  const spanLon = Math.min(180, Math.ceil(limitKm / Math.max(1, 111 * Math.cos(Math.min(89, Math.abs(latitude)) * RAD))));
  const spanLat = Math.ceil(limitKm / 111);
  let best: NearestPlace | null = null;
  for (let dLat = -spanLat; dLat <= spanLat; dLat += 1) {
    for (let dLon = -spanLon; dLon <= spanLon; dLon += 1) {
      const lon = ((cellLon + dLon + 180) % 360 + 360) % 360 - 180;
      for (const row of table.cells.get(`${cellLat + dLat},${lon}`) ?? []) {
        const km = distanceKm(latitude, longitude, table.latitude[row] / 1e5, table.longitude[row] / 1e5);
        if (km <= limitKm && (!best || km < best.km)) best = { row, km };
      }
    }
  }
  return best;
}

const slug = (text: string) => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Place, region and country tags for a GPS position. Country words come from the platform in the person's language. */
export function placeTags(table: PlaceTable, latitude: number, longitude: number): PhotoTag[] {
  const nearest = nearestPlace(table, latitude, longitude);
  if (!nearest) return [];
  const tags: PhotoTag[] = [];
  const { country, name: regionName } = table.regions[table.region[nearest.row]];
  if (nearest.km <= PLACE_RADIUS_KM) {
    tags.push({ id: `place.gn.${table.id[nearest.row]}`, facet: 'place', source: 'gps', name: table.names[nearest.row] });
  }
  const regionSlug = slug(regionName);
  if (regionName && regionSlug) tags.push({ id: `place.region.${country.toLowerCase()}-${regionSlug}`, facet: 'place', source: 'gps', name: regionName });
  if (/^[A-Z]{2}$/.test(country)) tags.push({ id: `place.country.${country.toLowerCase()}`, facet: 'place', source: 'gps' });
  return tags;
}

/** The country's name in a language, from the platform (never a raw code). Undefined when the platform has none. */
export function countryName(id: string, language: string): string | undefined {
  const match = /^place\.country\.([a-z]{2})$/.exec(id);
  if (!match) return undefined;
  try {
    const name = new Intl.DisplayNames([language], { type: 'region', fallback: 'none' }).of(match[1].toUpperCase());
    return name && name.toUpperCase() !== match[1].toUpperCase() ? name : undefined;
  } catch { return undefined; }
}

export interface CuratedSpot { id: string; name: string; latitude: number; longitude: number; radiusKm: number }

/** Curated photo spots the position is inside. A spot's radius is how far it can honestly be said to cover. */
export function curatedTags(spots: readonly CuratedSpot[], latitude: number, longitude: number): PhotoTag[] {
  return spots.filter((spot) => distanceKm(latitude, longitude, spot.latitude, spot.longitude) <= spot.radiusKm)
    .map((spot) => ({ id: spot.id, facet: 'landmark' as const, source: 'curated' as const, name: spot.name }));
}
