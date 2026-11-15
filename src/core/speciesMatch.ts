import type { SubjectKind } from './subjectTags';

/** One name the model can match a photo to, as stored in the labels file. */
export interface SpeciesLabel {
  common: string;
  scientific: string;
  group: 'bird' | 'mammal' | 'other';
  /** int8 numbers as base64, with the one scale that turns them back into the real vector. */
  vector: string;
  scale: number;
}

export interface Suggestion {
  index: number;
  label: SpeciesLabel;
  probability: number;
}

/** The model was trained with a logit scale of about 100: similarity is multiplied by this before turning into odds. */
const LOGIT_SCALE = 100;

export function decodeVector(label: Pick<SpeciesLabel, 'vector' | 'scale'>): Float32Array {
  const binary = atob(label.vector);
  const out = new Float32Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    const byte = binary.charCodeAt(i);
    out[i] = (byte > 127 ? byte - 256 : byte) * label.scale;
  }
  return out;
}

export function normalise(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum) || 1;
  return vector.map((value) => value / length);
}

const dot = (a: Float32Array, b: Float32Array) => { let sum = 0; for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i]; return sum; };

/** Cosine similarity of two vectors of any length. */
export function similarity(a: Float32Array, b: Float32Array): number {
  return dot(normalise(a), normalise(b));
}

/**
 * Rank the names for a photo's embedding, best first. `bonus` lets earlier choices nudge the order gently, and the
 * odds always sum to one across the list, so a probability is "how much of the choice goes to this name".
 */
export function rankSpecies(embedding: Float32Array, labels: readonly SpeciesLabel[], vectors: readonly Float32Array[], bonus: readonly number[] = []): Suggestion[] {
  const unit = normalise(embedding);
  const logits = vectors.map((vector, index) => LOGIT_SCALE * dot(unit, normalise(vector)) + (bonus[index] ?? 0));
  const top = Math.max(...logits);
  const weights = logits.map((value) => Math.exp(value - top));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((weight, index) => ({ index, label: labels[index], probability: weight / total })).sort((a, b) => b.probability - a.probability);
}

/** Up to three names worth showing. Nothing at all when no name stands out, so a wrong guess is never forced. */
export function pickSuggestions(ranked: readonly Suggestion[], minimumTop = 0.3, minimumOther = 0.1): Suggestion[] {
  if (!ranked.length || ranked[0].probability < minimumTop) return [];
  return ranked.filter((entry, position) => position === 0 || entry.probability >= minimumOther).slice(0, 3);
}

export function confidenceWord(probability: number): 'likely' | 'possible' | 'unsure' {
  return probability >= 0.8 ? 'likely' : probability >= 0.4 ? 'possible' : 'unsure';
}

/** The kind of photo a name implies. Animals mean wildlife, a person means people, and a pet is left for the user to place. */
export function kindFor(label: Pick<SpeciesLabel, 'group' | 'common'>): SubjectKind | undefined {
  if (label.common === 'Human') return 'people';
  if (label.group === 'bird' || label.group === 'mammal') return /^(Domestic|Horse|Highland cow|Sheep)/.test(label.common) ? 'other' : 'wildlife';
  return undefined;
}

export type SpeciesCounts = Record<string, number>;

/** Names the user has accepted before rise a little in the order: at most 1.5 on the scale the odds are made on. */
export function personalBonus(labels: readonly SpeciesLabel[], counts: SpeciesCounts): number[] {
  return labels.map((label) => Math.min(1.5, 0.5 * Math.log2(1 + (counts[label.common] ?? 0))));
}

export function recordAccepted(counts: SpeciesCounts, common: string): SpeciesCounts {
  return { ...counts, [common]: (counts[common] ?? 0) + 1 };
}

/** Photos whose embeddings are close enough to be the same scene or animal, such as the rest of a burst. */
export function similarPhotos(embedding: Float32Array, others: readonly { id: string; embedding: Float32Array }[], threshold = 0.92): string[] {
  const unit = normalise(embedding);
  return others.filter((other) => dot(unit, normalise(other.embedding)) >= threshold).map((other) => other.id);
}

/** How the labels file stores a vector. The Python tool does the same, so each can read the other's numbers. */
export function quantiseVector(vector: Float32Array): { vector: string; scale: number } {
  const max = Math.max(...vector.map(Math.abs)) || 1;
  const scale = max / 127;
  const bytes = Array.from(vector, (value) => Math.max(-127, Math.min(127, Math.round(value / scale))));
  return { vector: btoa(String.fromCharCode(...bytes.map((value) => (value < 0 ? value + 256 : value)))), scale };
}
