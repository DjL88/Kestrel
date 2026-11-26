import type { SpeciesEntry } from '../core/speciesSearch';

/**
 * The names species autocomplete searches, loaded once on first use from `public/models/species-names/`: `index.json`
 * (every species the app can name, scientific and English) and `banding-codes.json` (four-letter codes for North American
 * birds, worked out from the IOC English names by `tools/species/banding_codes.mjs`). Without the files the field still
 * takes any typed name; it just offers no suggestions.
 */
export interface SpeciesSearchData { entries: SpeciesEntry[]; codes: Map<string, string> }

let loading: Promise<SpeciesSearchData> | undefined;

const EMPTY: SpeciesSearchData = { entries: [], codes: new Map() };

export function loadSpeciesSearchData(fetcher: typeof fetch = fetch): Promise<SpeciesSearchData> {
  loading ??= (async () => {
    const base = `${(import.meta.env?.BASE_URL as string | undefined) ?? '/'}models/species-names/`;
    const read = async (name: string): Promise<unknown> => {
      const response = await fetcher(`${base}${name}`);
      if (!response.ok) throw new Error(`${name} ${response.status}`);
      return response.json();
    };
    try {
      const [index, banding] = await Promise.all([read('index.json'), read('banding-codes.json').catch(() => ({ codes: [] }))]);
      const species = (index as { species?: unknown }).species;
      if (!Array.isArray(species)) throw new Error('species names are not in the expected format');
      const entries = species
        .filter((row): row is [string, string?] => Array.isArray(row) && typeof row[0] === 'string')
        .map(([scientific, english]) => ({ scientific, common: typeof english === 'string' && english ? english : scientific }));
      const rows = (banding as { codes?: unknown }).codes;
      const codes = new Map<string, string>(
        Array.isArray(rows) ? rows.filter((row): row is [string, string] => Array.isArray(row) && /^[A-Z]{4}$/.test(String(row[0])) && typeof row[1] === 'string') : [],
      );
      return { entries, codes };
    } catch (error) {
      console.warn('Species suggestions unavailable', error);
      loading = undefined;
      return EMPTY;
    }
  })();
  return loading;
}

/** For tests: forget what was loaded. */
export function resetSpeciesSearchData(): void {
  loading = undefined;
}
