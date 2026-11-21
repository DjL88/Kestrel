import type { SpeciesLabel } from './speciesMatch';

/**
 * Where a person photographs, in the broad bird regions the world list uses (IOC breeding-range codes). Choosing
 * regions narrows the names offered, so a Red Kite is never weighed against ten thousand birds from another continent.
 */
export interface SpeciesRegion { id: string; label: string; codes: readonly string[] }

export const SPECIES_REGIONS: readonly SpeciesRegion[] = [
  { id: 'palearctic', label: 'Europe, North Africa and northern Asia', codes: ['PAL'] },
  { id: 'nearctic', label: 'North America', codes: ['NA'] },
  { id: 'neotropics', label: 'Central and South America', codes: ['SA'] },
  { id: 'afrotropics', label: 'Africa south of the Sahara', codes: ['AF'] },
  { id: 'oriental', label: 'South and South-East Asia', codes: ['OR'] },
  { id: 'australasia', label: 'Australia, New Guinea and New Zealand', codes: ['AU'] },
  { id: 'oceans', label: 'Oceans, islands and polar seas', codes: ['MA', 'PO', 'IO', 'AO', 'SO', 'AN'] },
];

export const DEFAULT_SPECIES_REGIONS: readonly string[] = ['palearctic'];

/** Keep only ids that name a real region; an empty or unknown choice falls back to the default, never to nothing. */
export function normaliseRegions(ids: readonly unknown[] | null | undefined): string[] {
  const known = new Set(SPECIES_REGIONS.map((region) => region.id));
  const kept = [...new Set((ids ?? []).filter((id): id is string => typeof id === 'string' && known.has(id)))];
  return kept.length ? kept : [...DEFAULT_SPECIES_REGIONS];
}

/**
 * The world names that can occur in the chosen regions. A name with no recorded range is kept, because unknown is not
 * the same as absent. Names that the app already ships (matched by scientific name) are not repeated.
 */
export function worldLabelsForRegions(world: readonly SpeciesLabel[], regionIds: readonly string[], have: ReadonlySet<string> = new Set()): SpeciesLabel[] {
  const wanted = new Set(SPECIES_REGIONS.filter((region) => normaliseRegions(regionIds).includes(region.id)).flatMap((region) => region.codes));
  return world.filter((label) => {
    if (have.has(label.scientific.toLowerCase())) return false;
    const regions = label.regions;
    return !regions || regions.length === 0 || regions.some((code) => wanted.has(code));
  });
}

export const SPECIES_REGIONS_KEY = 'kite44.speciesRegions';

export function readSpeciesRegions(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): string[] {
  try { return normaliseRegions(JSON.parse(storage?.getItem(SPECIES_REGIONS_KEY) ?? 'null')); } catch { return [...DEFAULT_SPECIES_REGIONS]; }
}

export function writeSpeciesRegions(ids: readonly string[], storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try { storage?.setItem(SPECIES_REGIONS_KEY, JSON.stringify(normaliseRegions(ids))); } catch { /* Not saved: the default applies next time. */ }
}

function safeStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; }
}
