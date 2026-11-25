import { buildSpeciesNameIndex, type SpeciesNameIndex, type SpeciesNameTable } from '../core/speciesNames';

/**
 * Loads species names for the session's language once, on demand, from `public/models/species-names/` (built by
 * `tools/species/make_names.mjs`): `index.json` (every species, scientific and English, about 0.5 MB) and, where the
 * IOC list covers the language, `<code>.json` (about 0.45 MB). English needs neither. Another source, such as the owner's
 * own translation database, can be laid over the IOC names with `addSpeciesNameTable`; it then wins.
 */
let index: SpeciesNameIndex | undefined;
let loading: Promise<SpeciesNameIndex | undefined> | undefined;
let loaded: SpeciesNameTable | undefined;
let loadedLanguage = '';
const extra: SpeciesNameTable[] = [];
const listeners = new Set<() => void>();

/** Languages the IOC multilingual list has names in; the others show the scientific name. */
export const IOC_NAME_LANGUAGES = ['da', 'nl', 'fi', 'fr', 'de', 'it', 'nb', 'pt', 'es', 'sv', 'is'];

export function speciesNameIndex(): SpeciesNameIndex | undefined {
  return index;
}

export function onSpeciesNamesLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function rebuild() {
  index = buildSpeciesNameIndex(loadedLanguage, [...extra, ...(loaded ? [loaded] : [])]);
  for (const listener of listeners) listener();
}

/** Lays another name table over the IOC names (first wins), for example the owner's own database. */
export function addSpeciesNameTable(table: SpeciesNameTable) {
  extra.unshift(table);
  if (loadedLanguage) rebuild();
}

interface IndexFile { attribution: string; source: string; species: [string, string][]; families?: [string, string][] }
interface LanguageFile { names: Record<string, string> }

export function loadSpeciesNames(language: string): Promise<SpeciesNameIndex | undefined> {
  if (language === 'en' || language.startsWith('en-')) return Promise.resolve(undefined);
  const code = language.split('-')[0];
  loading ??= (async () => {
    try {
      const base = `${(import.meta.env?.BASE_URL as string | undefined) ?? '/'}models/species-names/`;
      const read = async <T>(name: string): Promise<T> => {
        const response = await fetch(`${base}${name}`);
        if (!response.ok) throw new Error(`${name} ${response.status}`);
        return response.json() as Promise<T>;
      };
      const [all, local] = await Promise.all([
        read<IndexFile>('index.json'),
        IOC_NAME_LANGUAGES.includes(code) ? read<LanguageFile>(`${code}.json`) : Promise.resolve<LanguageFile>({ names: {} }),
      ]);
      if (!Array.isArray(all.species) || typeof local.names !== 'object') throw new Error('species names are not in the expected format');
      loadedLanguage = language;
      loaded = { source: all.source, attribution: all.attribution, language, names: [
        ...all.species.map(([scientific, english]): [string, string, string | null] => [scientific, english, local.names[scientific] ?? null]),
        // A photo named only by family ("Owls") shows the scientific family where the source has no local name.
        ...(all.families ?? []).map(([scientific, english]): [string, string, string | null] => [scientific, english, null]),
      ] };
      rebuild();
    } catch (error) {
      // Without the files the stored names are shown as they are; nothing else changes.
      console.warn('Species names unavailable for', language, error);
      loading = undefined;
    }
    return index;
  })();
  return loading;
}
