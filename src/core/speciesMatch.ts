import type { SubjectKind } from './subjectTags';

/** One name the model can match a photo to, as stored in the labels file. */
export interface SpeciesLabel {
  common: string;
  scientific: string;
  group: 'bird' | 'mammal' | 'other';
  /** int8 numbers as base64, with the one scale that turns them back into the real vector. */
  vector: string;
  scale: number;
  /** World-list breeding regions (IOC codes). Absent for names the app ships by hand. */
  regions?: string[];
}

export interface Suggestion {
  index: number;
  label: SpeciesLabel;
  /** Relative share among configured labels, NOT calibrated identity probability. */
  probability: number;
}

/** The model was trained with a logit scale of about 100: similarity is multiplied by this before turning into odds. */
const LOGIT_SCALE = 100;

export function decodeVector(label: Pick<SpeciesLabel, 'vector' | 'scale'>): Float32Array {
  if (!Number.isFinite(label.scale) || label.scale <= 0) throw new RangeError('Invalid species vector scale');
  const binary = atob(label.vector);
  const out = new Float32Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    const byte = binary.charCodeAt(i);
    out[i] = (byte > 127 ? byte - 256 : byte) * label.scale;
  }
  return out;
}

/** Finite non-zero model evidence only. Corrupt cache/ONNX output must abstain. */
const validVector = (vector: Float32Array): boolean =>
  vector.length > 0 && vector.every(Number.isFinite) && vector.some((value) => value !== 0);

/** Scale first to avoid overflowing squares even with a finite model output. */
export function normalise(vector: Float32Array): Float32Array {
  if (!validVector(vector)) return new Float32Array(vector.length);
  let peak = 0;
  for (const value of vector) peak = Math.max(peak, Math.abs(value));
  let sum = 0;
  for (const value of vector) {
    const scaled = value / peak;
    sum += scaled * scaled;
  }
  const length = Math.sqrt(sum);
  return vector.map((value) => value / peak / length);
}

const dot = (a: Float32Array, b: Float32Array) => { let sum = 0; for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i]; return sum; };

/** Cosine similarity of two vectors of any length. */
export function similarity(a: Float32Array, b: Float32Array): number {
  if (!validVector(a) || !validVector(b) || a.length !== b.length) return 0;
  return dot(normalise(a), normalise(b));
}

/**
 * Rank the names for a photo's embedding, best first. `bonus` lets earlier choices nudge the order gently, and the
 * odds always sum to one across the list, so a probability is "how much of the choice goes to this name".
 */
export function rankSpecies(embedding: Float32Array, labels: readonly SpeciesLabel[], vectors: readonly Float32Array[], bonus: readonly number[] = []): Suggestion[] {
  // These shares are conditional on the configured (currently UK-only) label
  // catalogue, NOT calibrated probabilities of the true animal's identity.
  // A mismatched model/asset version or malformed inference must not force
  // a confident name merely because the softmax still sums to one.
  if (!validVector(embedding) || labels.length === 0 || labels.length !== vectors.length ||
      vectors.some((vector) => vector.length !== embedding.length || !validVector(vector)) ||
      labels.some((label) => !label || !label.common?.trim() || !label.scientific?.trim())) return [];
  const unit = normalise(embedding);
  const logits = vectors.map((vector, index) => {
    const userBonus = bonus[index];
    const safeBonus = Number.isFinite(userBonus) && userBonus >= 0 ? Math.min(1.5, userBonus) : 0;
    return LOGIT_SCALE * dot(unit, normalise(vector)) + safeBonus;
  });
  const top = Math.max(...logits);
  const weights = logits.map((value) => Math.exp(value - top));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((weight, index) => ({ index, label: labels[index], probability: weight / total }))
    .sort((a, b) => b.probability - a.probability || a.index - b.index);
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
  return labels.map((label) => {
    const count = counts[label.common];
    return Number.isSafeInteger(count) && count >= 0 ? Math.min(1.5, 0.5 * Math.log2(1 + count)) : 0;
  });
}

export function recordAccepted(counts: SpeciesCounts, common: string): SpeciesCounts {
  const current = counts[common];
  const safe = Number.isSafeInteger(current) && current >= 0 ? Math.min(current, 1_000_000) : 0;
  return { ...counts, [common]: safe + 1 };
}

/** Photos whose embeddings are close enough to be the same scene or animal, such as the rest of a burst. */
export function similarPhotos(embedding: Float32Array, others: readonly { id: string; embedding: Float32Array }[], threshold = 0.92): string[] {
  if (!validVector(embedding) || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) return [];
  const unit = normalise(embedding);
  return others.filter((other) => validVector(other.embedding) &&
    other.embedding.length === embedding.length &&
    dot(unit, normalise(other.embedding)) >= threshold).map((other) => other.id);
}

/** How the labels file stores a vector. The Python tool does the same, so each can read the other's numbers. */
export function quantiseVector(vector: Float32Array): { vector: string; scale: number } {
  const max = Math.max(...vector.map(Math.abs)) || 1;
  const scale = max / 127;
  const bytes = Array.from(vector, (value) => Math.max(-127, Math.min(127, Math.round(value / scale))));
  return { vector: btoa(String.fromCharCode(...bytes.map((value) => (value < 0 ? value + 256 : value)))), scale };
}
