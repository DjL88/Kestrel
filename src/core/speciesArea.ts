import type { SpeciesLabel } from './speciesMatch';
import { SPECIES_REGIONS, normaliseRegions, worldLabelsForRegions } from './speciesRegions';

/**
 * Where a project's photos were taken, for ranking species names: the person's home region (the default), anywhere in
 * the world, one or more regions, or one country. Someone back from Venezuela can set that project to South America or
 * Worldwide, so a Venezuelan bird is not forced onto a UK look-alike. Only the regions are used for ranking; a country
 * is kept as chosen so it can be shown in the person's words.
 */
export type SpeciesArea =
  | { kind: 'home' }
  | { kind: 'world' }
  | { kind: 'regions'; ids: string[] }
  | { kind: 'country'; code: string };

export const ALL_REGION_IDS: readonly string[] = SPECIES_REGIONS.map((region) => region.id);

/** The app's region ids from the realm codes the species lists use (IOC: PAL NA SA AF OR AU; PO for Pacific islands). */
const REGION_OF_REALM: Record<string, string> = { PAL: 'palearctic', NA: 'nearctic', SA: 'neotropics', AF: 'afrotropics', OR: 'oriental', AU: 'australasia', PO: 'oceans' };

/**
 * Countries to realms: the same table as tools/species/realms.mjs, which built the lists' region codes (a test keeps
 * them equal). A country that spans two realms (China, Mexico, Indonesia) gives both, so nothing is dropped.
 */
const REALM_COUNTRIES: Record<string, string> = {
  PAL: 'AD AL AM AT AX AZ BA BE BG BY CH CY CZ DE DK DZ EE EG ES FI FO FR GB GE GG GI GR HR HU IE IL IM IQ IR IS IT JE JO JP KG KP KR KW KZ LB LI LT LU LV LY MA MC MD ME MK MN MT NL NO PL PS PT QA RO RS RU SA SE SI SJ SK SM SY TJ TM TN TR UA UZ VA XK AE BH OM YE AF PK CN EH MR',
  NA: 'US CA GL PM BM MX',
  SA: 'MX GT BZ SV HN NI CR PA CO VE GY SR GF EC PE BR BO PY CL AR UY FK GS CU JM HT DO PR BS TC KY VG VI AI AG KN MS GP DM MQ LC VC BB GD TT AW CW BQ SX MF BL',
  AF: 'SN GM GW GN SL LR CI ML BF GH TG BJ NE NG TD SD SS CM CF GQ GA CG CD AO ET ER DJ SO KE UG RW BI TZ MZ MW ZM ZW BW NA ZA LS SZ MG MU RE YT KM SC ST CV SH YE OM SA MR EH',
  OR: 'IN PK NP BT BD LK MV MM TH LA KH VN MY SG BN ID PH TW CN HK MO TL IO',
  AU: 'AU NZ PG ID TL SB NC VU NF',
  PO: 'FJ WS TO TV KI NR MH FM PW MP GU AS CK NU PF PN TK WF UM',
};
export const REALM_COUNTRY_TABLE: Readonly<Record<string, string>> = REALM_COUNTRIES;

const regionsByCountry = new Map<string, string[]>();
for (const [realm, codes] of Object.entries(REALM_COUNTRIES)) {
  for (const code of codes.split(/\s+/)) regionsByCountry.set(code, [...new Set([...(regionsByCountry.get(code) ?? []), REGION_OF_REALM[realm]])]);
}

/** Every country that can be picked (ISO 3166-1 alpha-2), in code order; the screen sorts them by their local name. */
export const SPECIES_COUNTRIES: readonly string[] = [...regionsByCountry.keys()].sort();

/** The app's regions for one country, or none for an unknown code. */
export function regionsForCountry(code: string): string[] {
  return regionsByCountry.get(code.trim().toUpperCase()) ?? [];
}

/** A stored area, checked. Anything unknown is read as absent, which means the home region. */
export function parseSpeciesArea(value: unknown): SpeciesArea | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.kind === 'home') return { kind: 'home' };
  if (raw.kind === 'world') return { kind: 'world' };
  if (raw.kind === 'country' && typeof raw.code === 'string' && regionsForCountry(raw.code).length) return { kind: 'country', code: raw.code.toUpperCase() };
  if (raw.kind === 'regions' && Array.isArray(raw.ids)) {
    const ids = raw.ids.filter((id): id is string => typeof id === 'string' && ALL_REGION_IDS.includes(id));
    if (ids.length) return { kind: 'regions', ids: [...new Set(ids)] };
  }
  return undefined;
}

/** The regions a project's species are ranked from. No choice (or "home") means the person's home regions. */
export function regionIdsForArea(area: SpeciesArea | undefined, home: readonly string[]): string[] {
  if (!area || area.kind === 'home') return normaliseRegions(home);
  if (area.kind === 'world') return [...ALL_REGION_IDS];
  if (area.kind === 'country') return normaliseRegions(regionsForCountry(area.code));
  return normaliseRegions(area.ids);
}

/** The area actually used, as stored on a photo beside its name: "home" is written out, so a later change of home does not rewrite history. */
export function resolvedArea(area: SpeciesArea | undefined, home: readonly string[]): Exclude<SpeciesArea, { kind: 'home' }> {
  if (area?.kind === 'world' || area?.kind === 'country') return area;
  const ids = regionIdsForArea(area, home);
  return ids.length === ALL_REGION_IDS.length ? { kind: 'world' } : { kind: 'regions', ids };
}

export const sameArea = (a: SpeciesArea | undefined, b: SpeciesArea | undefined) => JSON.stringify(a ?? { kind: 'home' }) === JSON.stringify(b ?? { kind: 'home' });

/**
 * The names to rank for the given regions: the shipped UK list (only when Europe and northern Asia is among the
 * regions, because every name on it is a UK species), then the world bird list and each other group, filtered to the
 * regions. A name already listed is not repeated. Unknown range is kept, as everywhere else.
 */
export function speciesLabelsForRegions(
  shipped: readonly SpeciesLabel[], world: readonly SpeciesLabel[], extras: readonly (readonly SpeciesLabel[])[], regionIds: readonly string[],
): SpeciesLabel[] {
  const regions = normaliseRegions(regionIds);
  const labels: SpeciesLabel[] = regions.includes('palearctic') ? [...shipped] : [];
  const have = new Set(labels.map((label) => label.scientific.toLowerCase()));
  for (const list of [world, ...extras]) {
    for (const label of worldLabelsForRegions(list, regions, have)) {
      have.add(label.scientific.toLowerCase());
      labels.push(label);
    }
  }
  return labels;
}

/**
 * The broad region (or two, near a boundary) a GPS position falls in. Coarse on purpose: it only suggests a choice the
 * person confirms, and a position near a boundary gives both sides rather than a confident wrong one. Runs on the device;
 * the position is never sent anywhere.
 */
export function regionsForPosition(latitude: number, longitude: number): string[] {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
  const lat = latitude, lon = longitude;
  const out = new Set<string>();
  if (lat <= -60) return ['oceans'];
  // Hawaii and the open Pacific islands.
  if (lat > 15 && lat < 26 && lon > -162 && lon < -152) return ['oceans'];
  if ((lon >= 172 || lon <= -140) && lat > -30 && lat < 30) return ['oceans'];
  // The Americas (and Greenland).
  if (lon >= -170 && lon <= -25) {
    if (lat >= 28) out.add('nearctic');
    if (lat <= 13) out.add('neotropics');
    if (lat > 13 && lat < 28) { out.add('nearctic'); out.add('neotropics'); }
    return [...out];
  }
  // Chukotka, across the date line.
  if (lon < -170) return ['palearctic'];
  // Australia, New Zealand, New Guinea and the islands just east of them.
  if (lon >= 112 && lat <= -10) out.add('australasia');
  if (lon >= 130 && lon < 156 && lat > -11 && lat <= 0) out.add('australasia');
  if (lon >= 155 && lon < 172 && lat > -25 && lat < -5) { out.add('australasia'); out.add('oceans'); }
  // Wallacea, between the Oriental and Australasian sides.
  if (lon >= 115 && lon < 130 && lat > -11 && lat <= 0) { out.add('oriental'); out.add('australasia'); }
  if (out.size) return [...out];
  // Africa and Arabia.
  if (lon >= -25 && lon < 60 && lat < 37) {
    if (lon >= 35 && lat >= 12 && lat < 30) return ['palearctic', 'afrotropics'];
    if (lat < 20) {
      out.add('afrotropics');
      if (lon >= 52 && lat < 0) out.add('oceans');
      return [...out];
    }
    if (lat < 30) return ['palearctic', 'afrotropics'];
    return ['palearctic'];
  }
  // South and South-East Asia, with a shared band along the Himalaya and southern China.
  if (lon >= 60 && lon < 150) {
    if (lat < 0 && lon < 112) return ['oriental', 'oceans'];
    // The Indian subcontinent up to the Himalaya (about 30°N); east of it, southern China up to about 26°N.
    const edge = lon < 98 ? 30 : 26;
    if (lat < edge && !(lon >= 120 && lat > 24)) return ['oriental'];
    if (lat < (lon < 98 ? 36 : 34) && lon < 123) return ['palearctic', 'oriental'];
  }
  return ['palearctic'];
}

/**
 * A suggestion for where a project's photos were taken, from the GPS the files carry, or null when there is nothing to
 * suggest (no positions, or every position is already in the home regions). Positions are read here and never leave
 * the device; the person confirms the suggestion with one tap.
 */
export function suggestAreaFromPositions(positions: readonly { latitude: number; longitude: number }[], home: readonly string[]): SpeciesArea | null {
  const found = new Set<string>();
  for (const position of positions) for (const id of regionsForPosition(position.latitude, position.longitude)) found.add(id);
  if (!found.size) return null;
  const homeIds = new Set(normaliseRegions(home));
  if ([...found].every((id) => homeIds.has(id))) return null;
  const ids = ALL_REGION_IDS.filter((id) => found.has(id));
  return ids.length >= ALL_REGION_IDS.length - 1 ? { kind: 'world' } : { kind: 'regions', ids };
}

/**
 * After the project's place changes, photos that only carry the app's own automatic name (or no name) are looked at
 * again with the new place's names. Anything the person named, kept or removed stays exactly as it is: a name the
 * person kept is in `tags` but not `autoTags`, and removed names stay in `declinedTags`. Only wildlife photos reopen.
 */
export function reopenForNewArea<T extends { subjectKind?: string; speciesChecked?: boolean; tags?: string[]; autoTags?: string[]; subjectNames?: string[]; removedAt?: number; speciesArea?: SpeciesArea }>(frames: readonly T[]): { frames: T[]; reopened: number } {
  let reopened = 0;
  const next = frames.map((frame) => {
    if (frame.removedAt != null || frame.subjectKind !== 'wildlife' || !frame.speciesChecked || frame.subjectNames?.length) return frame;
    const auto = new Set((frame.autoTags ?? []).map((tag) => tag.toLowerCase()));
    if ((frame.tags ?? []).some((tag) => !auto.has(tag.toLowerCase()))) return frame;
    reopened += 1;
    const { speciesArea: _area, ...rest } = frame;
    return { ...rest, tags: [], autoTags: [], speciesChecked: false } as unknown as T;
  });
  return { frames: next, reopened };
}
