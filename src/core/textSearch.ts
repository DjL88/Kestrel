import { decodeVector, normalise } from './speciesMatch';

/**
 * Plain-language photo search, on the device. A photo's picture vector (CLIP image encoder) is compared with the
 * typed words' vector (CLIP text encoder) by cosine similarity. Words always still work without the model:
 * filename, tags and species names are matched by the existing text filter, so search never errors.
 */
export const TEXT_SEARCH_MODEL_ID = 'clip-vit-b32';
/** Below this cosine similarity a photo is not offered as a match (CLIP B/32 text-to-image scores sit near 0.2-0.3). */
export const MATCH_FLOOR = 0.2;
/** A photo must also be within this distance of the best match, so a vague query does not return the whole library. */
export const MATCH_BAND = 0.06;

/** A picture vector kept with the project: int8 numbers as base64, one scale, and the model that made it. */
export interface StoredVector { v: string; scale: number; model: string }

export function normaliseQuery(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 200);
}

/** Too short to mean anything to the model (one or two letters match nearly everything). */
export const isSearchable = (query: string): boolean => normaliseQuery(query).length >= 3;

export function encodeVector(vector: Float32Array): StoredVector {
  const unit = normalise(vector);
  if (!unit.length || !unit.some((value) => value !== 0) || !unit.every(Number.isFinite)) {
    throw new RangeError('Cannot index a damaged or empty photo vector.');
  }
  let peak = 0;
  for (const x of unit) peak = Math.max(peak, Math.abs(x));
  const scale = peak > 0 ? peak / 127 : 1;
  const bytes = new Uint8Array(unit.length);
  for (let i = 0; i < unit.length; i += 1) bytes[i] = Math.round(unit[i] / scale) & 0xff;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return { v: btoa(binary), scale, model: TEXT_SEARCH_MODEL_ID };
}

/** Null for a vector that is missing, from another model, or damaged: that photo is simply embedded again. */
export function readVector(stored: StoredVector | undefined, dim = 512): Float32Array | null {
  if (!stored || stored.model !== TEXT_SEARCH_MODEL_ID) return null;
  try {
    const vector = decodeVector({ vector: stored.v, scale: stored.scale });
    if (vector.length !== dim || !vector.some((value) => value !== 0) || !vector.every(Number.isFinite)) return null;
    return normalise(vector);
  } catch { return null; }
}

export interface Scored { id: string; score: number }

/** Photos worth showing for the words, best first. Empty when nothing is close enough: that is a normal answer. */
export function rankByQuery(query: Float32Array, photos: readonly { id: string; vector: Float32Array | null }[]): Scored[] {
  const scored: Scored[] = [];
  if (!query.length || !query.every(Number.isFinite) || !query.some((x) => x !== 0)) return scored;
  const unitQuery = normalise(query);
  for (const { id, vector } of photos) {
    if (!vector || vector.length !== query.length || !vector.every(Number.isFinite) ||
        !vector.some((x) => x !== 0)) continue;
    const unitPhoto = normalise(vector);
    let dot = 0;
    for (let i = 0; i < query.length; i += 1) dot += unitQuery[i] * unitPhoto[i];
    if (Number.isFinite(dot)) scored.push({ id, score: dot });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  return scored.filter((s) => s.score >= MATCH_FLOOR && s.score >= best - MATCH_BAND);
}

export type SearchState = 'words-only' | 'preparing' | 'ready' | 'offer-download';

/** What to tell the person under the search box. Never an error, never jargon. */
export function searchNote(state: SearchState, done: number, total: number): string {
  switch (state) {
    case 'preparing': return `Getting your photos ready to search by description (${done} of ${total}). Words in names and tags already work.`;
    case 'offer-download': return 'Searching by what is in the picture needs a small one-off download. Names and tags work now.';
    case 'ready': return '';
    default: return 'Searching names, tags and species.';
  }
}

/** Frames to show: the words filter's matches, plus close picture matches, with picture matches ordered best first. */
export function mergeMatches<T extends { id: string }>(wordMatches: readonly T[], all: readonly T[], ranked: readonly Scored[]): T[] {
  if (!ranked.length) return [...wordMatches];
  const byId = new Map(all.map((f) => [f.id, f]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const { id } of ranked) { const f = byId.get(id); if (f && !seen.has(id)) { out.push(f); seen.add(id); } }
  for (const f of wordMatches) if (!seen.has(f.id)) out.push(f);
  return out;
}
