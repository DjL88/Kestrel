/**
 * Species names in the person's language (owner decision 10). Every name is keyed by scientific name; the English
 * common name is also indexed because photos store the name the person or the model chose, which is English today.
 *
 * Several tables can be loaded at once and the first that knows a name wins, so the owner's own translation database can
 * be laid over the IOC list later without changing any caller. Where no table has a local name, the scientific name is
 * shown (never a guessed translation), and a name nobody knows is shown exactly as it was stored.
 */
export interface SpeciesNameTable {
  /** Where the names come from, for the attribution line. */
  source: string;
  attribution: string;
  language: string;
  /** [scientific, English common, local or null]. */
  names: [string, string, string | null][];
}

export type NameKind = 'local' | 'scientific' | 'english' | 'as-stored';

export interface SpeciesNameIndex {
  language: string;
  lookup(name: string): { scientific: string; english: string; local: string | null } | undefined;
}

/** One index over several tables, in priority order (first wins for a local name). */
export function buildSpeciesNameIndex(language: string, tables: SpeciesNameTable[]): SpeciesNameIndex {
  const entries = new Map<string, { scientific: string; english: string; local: string | null }>();
  for (const table of tables) {
    for (const [scientific, english, local] of table.names) {
      const key = scientific.toLowerCase();
      const existing = entries.get(key);
      const entry = existing ?? { scientific, english, local: null };
      if (!entry.local && local) entry.local = local;
      if (!existing) {
        entries.set(key, entry);
        entries.set(`en:${english.toLowerCase()}`, entry);
      }
    }
  }
  return {
    language,
    lookup: (name) => entries.get(name.toLowerCase()) ?? entries.get(`en:${name.toLowerCase()}`),
  };
}

const isEnglish = (language: string) => language === 'en' || language.startsWith('en-');

/**
 * The name to show for a stored species name. English readers see the English common name; others see the local name,
 * else the scientific name. A name no table knows (one the person typed, or a group like "Owls") stays as stored.
 */
export function displaySpeciesName(stored: string, index: SpeciesNameIndex | undefined): { name: string; kind: NameKind } {
  const entry = index?.lookup(stored.trim());
  if (!entry || !index) return { name: stored, kind: 'as-stored' };
  if (isEnglish(index.language)) return { name: entry.english, kind: 'english' };
  if (entry.local) return { name: entry.local, kind: 'local' };
  return { name: entry.scientific, kind: 'scientific' };
}
