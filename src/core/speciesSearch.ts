/**
 * Species autocomplete: match what a person types against English and scientific names, and against four-letter
 * banding codes (AMRO for American Robin), so a bander can type the code they already write on the data sheet.
 *
 * The codes are worked out from the English name with the published four-letter rule (Pyle and DeSante, as used by the
 * North American banding offices). This is not the official code list: where two birds would get the same code the
 * official list breaks the tie by hand, so here neither gets one (unknown stays unknown, never a guessed code).
 */

export interface SpeciesEntry {
  scientific: string;
  /** English name; may equal the scientific name when the list has no English name. */
  common: string;
}

export interface SpeciesHit extends SpeciesEntry {
  /** Four-letter code, when this species has one in the code table. */
  code?: string;
  matchedBy: 'code' | 'name' | 'scientific';
}

/** Words of an English bird name for the code rule: hyphens and spaces split words; apostrophes and accents go. */
function codeWords(common: string): string[] {
  return common
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .split(/[\s-]+/)
    .map((word) => word.replace(/[^A-Za-z]/g, ''))
    .filter(Boolean);
}

/**
 * The four-letter code by the standard rule, or null when the rule doesn't give one (five or more words, or too few letters).
 * One word: its first four letters. Two: two letters of each. Three: one letter from each of the first two and two from
 * the last. Four: the first letter of each.
 */
export function bandingCodeFor(common: string): string | null {
  const words = codeWords(common).map((word) => word.toUpperCase());
  let code: string;
  if (words.length === 1) code = words[0].slice(0, 4);
  else if (words.length === 2) code = words[0].slice(0, 2) + words[1].slice(0, 2);
  else if (words.length === 3) code = words[0][0] + words[1][0] + words[2].slice(0, 2);
  else if (words.length === 4) code = words.map((word) => word[0]).join('');
  else return null;
  return code.length === 4 ? code : null;
}

/**
 * Code → scientific name for the given species. A code two species would share is left out for both, because the
 * official list settles those by hand and a guess here could name the wrong bird.
 */
export function buildBandingCodes(entries: readonly SpeciesEntry[]): Map<string, string> {
  const seen = new Map<string, string | null>();
  for (const entry of entries) {
    if (!entry.common || entry.common === entry.scientific) continue;
    const code = bandingCodeFor(entry.common);
    if (!code) continue;
    const before = seen.get(code);
    if (before === undefined) seen.set(code, entry.scientific);
    else if (before !== entry.scientific) seen.set(code, null);
  }
  const out = new Map<string, string>();
  for (const [code, scientific] of seen) if (scientific) out.set(code, scientific);
  return out;
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s-]+/g, ' ').trim();

/** How well a folded name matches a folded query: 0 for the whole name starting with it, 1 for a later word, else -1. */
function nameRank(name: string, query: string): number {
  if (name.startsWith(query)) return 0;
  if (name.split(' ').some((word, index) => index > 0 && word.startsWith(query))) return 1;
  return name.includes(query) && query.length >= 3 ? 2 : -1;
}

/**
 * Up to `limit` species for what was typed. A four-letter code match comes first, then names that start with the text,
 * then names with a later word that starts with it, then scientific names. Shorter names come first within a rank.
 */
export function searchSpecies(
  typed: string,
  entries: readonly SpeciesEntry[],
  codes: ReadonlyMap<string, string> = new Map(),
  limit = 8,
): SpeciesHit[] {
  const query = fold(typed);
  if (query.length < 2) return [];
  const codeOf = new Map<string, string>();
  for (const [code, scientific] of codes) codeOf.set(scientific, code);
  const ranked: Array<{ hit: SpeciesHit; rank: number }> = [];
  const compact = typed.trim().toUpperCase();
  const byCode = /^[A-Z]{4}$/.test(compact) ? codes.get(compact) : undefined;
  for (const entry of entries) {
    const code = codeOf.get(entry.scientific);
    if (byCode && entry.scientific === byCode) {
      ranked.push({ hit: { ...entry, code, matchedBy: 'code' }, rank: -1 });
      continue;
    }
    const common = entry.common !== entry.scientific ? nameRank(fold(entry.common), query) : -1;
    if (common >= 0) {
      ranked.push({ hit: { ...entry, code, matchedBy: 'name' }, rank: common });
      continue;
    }
    const scientific = nameRank(fold(entry.scientific), query);
    if (scientific >= 0) ranked.push({ hit: { ...entry, code, matchedBy: 'scientific' }, rank: 3 + scientific });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.hit.common.length - b.hit.common.length || a.hit.common.localeCompare(b.hit.common));
  return ranked.slice(0, limit).map((item) => item.hit);
}
