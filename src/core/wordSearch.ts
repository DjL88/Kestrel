/**
 * Search in plain words, on the device and with no model: "dipper on a rock" looks for photos whose names, species,
 * vehicles and tags hold every meaningful word (dipper, rock), ignoring little words such as "on" and "a". When no photo
 * holds every word, the photos holding the most of them are offered instead, and the caller says so: never a silent
 * guess. Photos found by what the picture looks like (`textSearch.ts`, when the picture search pack is on this device)
 * are added to the word matches by the caller.
 */

/** Little words that carry no subject. English only for now; other languages simply keep every word. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'on', 'in', 'at', 'of', 'with', 'and', 'or', 'by', 'to', 'from', 'near', 'into', 'onto', 'over',
  'under', 'for', 'is', 'are', 'was', 'were', 'it', 'its', 'some', 'my', 'me', 'show', 'find', 'photo', 'photos',
  'picture', 'pictures', 'image', 'images', 'shot', 'shots',
]);

function words(text: string): string[] {
  return text.normalize('NFC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** The words a query is searched by: lower case, without little words, each once. All little words: those are kept. */
export function searchTerms(query: string): string[] {
  const all = words(query.slice(0, 200));
  const meaningful = all.filter((word) => !STOP_WORDS.has(word));
  return [...new Set(meaningful.length ? meaningful : all)];
}

/** "dipper" finds "dippers", "dipper's" and "Dipper"; "dippers" also finds "dipper"; "rock" finds "rocky". */
function termFound(term: string, haystack: readonly string[]): boolean {
  const singular = term.length > 3 && term.endsWith('es') ? [term.slice(0, -2), term.slice(0, -1)]
    : term.length > 3 && term.endsWith('s') ? [term.slice(0, -1)] : [];
  return haystack.some((word) => word.startsWith(term) || singular.some((form) => word.startsWith(form)));
}

export interface WordSearchItem { id: string; text: string }

export interface WordSearchOutcome {
  /** The query's meaningful words. Empty: nothing to search by, every photo is shown. */
  terms: string[];
  /** Photos holding every word (or the whole query as typed). */
  complete: string[];
  /** Only when `complete` is empty: the photos holding the most words, and which words those were. */
  partial: string[];
  partialTerms: string[];
}

export function searchByWords(items: readonly WordSearchItem[], query: string): WordSearchOutcome {
  const terms = searchTerms(query);
  const outcome: WordSearchOutcome = { terms, complete: [], partial: [], partialTerms: [] };
  if (!terms.length) return outcome;
  const typed = query.normalize('NFC').trim().toLowerCase();
  let best = 0;
  const found: { id: string; terms: string[] }[] = [];
  for (const item of items) {
    const text = item.text.normalize('NFC').toLowerCase();
    if (typed && text.includes(typed)) { outcome.complete.push(item.id); continue; }
    const haystack = words(text);
    const hits = terms.filter((term) => termFound(term, haystack));
    if (hits.length === terms.length) outcome.complete.push(item.id);
    else if (hits.length) { found.push({ id: item.id, terms: hits }); best = Math.max(best, hits.length); }
  }
  if (outcome.complete.length || !best) return outcome;
  const top = found.filter((entry) => entry.terms.length === best);
  outcome.partial = top.map((entry) => entry.id);
  outcome.partialTerms = terms.filter((term) => top.some((entry) => entry.terms.includes(term)));
  return outcome;
}
