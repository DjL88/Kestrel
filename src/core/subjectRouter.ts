import type { SubjectKind } from './subjectTags';

/**
 * The category gate: decide what kind of thing a photo shows BEFORE any species or model name is offered.
 *
 * The species model compares a picture with a closed list of birds and mammals, so anything outside that list (a
 * helicopter, a car, a church) is forced onto its nearest animal. The gate fixes that by matching the picture against a
 * much wider list of subject categories first, using one general image-and-text model, and only letting the animal
 * identifier run when the picture really is an animal. When it is not sure it says so rather than guessing.
 *
 * Pure and deterministic: no model is loaded here. The picture's embedding and the categories' vectors come in as numbers.
 */
export type CategoryGroup = 'animal' | 'person' | 'plant' | 'vehicle' | 'structure' | 'scene' | 'sky' | 'object' | 'event';
/** A specialist step that may follow the gate. Not built yet for most; recorded so the taxonomy stays the single list. */
export type IdentifyRoute = 'species' | 'aircraft' | 'car' | 'boat' | null;

export interface SubjectCategory {
  id: string;
  label: string;
  group: CategoryGroup;
  /** The coarse kind Kestrel already uses for a photo. */
  kind: SubjectKind;
  /** Plain-language descriptions. Their text embeddings are averaged into the category's vector. */
  prompts: string[];
  /** Classes of the YOLOX detector that support this category. Only classes the detector reports (see SUBJECT_CLASSES). */
  detector: string[];
  identify: IdentifyRoute;
}

export interface Taxonomy { version: number; groups: CategoryGroup[]; categories: SubjectCategory[] }

/** Same scale the species model uses: similarity is multiplied by this before it is turned into odds. */
export const LOGIT_SCALE = 100;
/**
 * Starting values, NOT calibrated on real photographs. They err towards "not sure". Tune them on a labelled set of the
 * owner's own photos (helicopters, aircraft, cars, birds, scenery) before relying on the wording.
 */
export const ROUTER_THRESHOLDS = { minimumProbability: 0.45, minimumMargin: 0.15, detectorBonus: 1.5, detectorMinimumScore: 0.5 } as const;

export interface DetectorEvidence { label: string; score: number }
export interface Ranked { category: SubjectCategory; probability: number }
export interface RouteResult {
  /** The best category, or null when the router is not sure enough to say. */
  category: SubjectCategory | null;
  /** The best-scoring category even when not sure, for showing as "possibly". */
  best: SubjectCategory;
  probability: number;
  margin: number;
  confident: boolean;
  /** The best few, most likely first. */
  top: Ranked[];
  /** Total probability of every category the species list can name (birds, birds of prey, waterbirds, mammals). */
  speciesProbability: number;
  /** Total probability of every animal category, including pets and farm animals the species list does not cover. */
  animalProbability: number;
}

/**
 * Cosine similarity without squaring unscaled model outputs. Even entirely finite
 * embeddings can overflow ordinary dot products/norms (e.g. 1e200 * 1e200),
 * leaving NaN probabilities that must never become a subject claim.
 */
function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let aMax = 0;
  let bMax = 0;
  for (let i = 0; i < a.length; i += 1) {
    aMax = Math.max(aMax, Math.abs(a[i]));
    bMax = Math.max(bMax, Math.abs(b[i]));
  }
  let dot = 0;
  let aSquared = 0;
  let bSquared = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] / aMax;
    const bv = b[i] / bMax;
    dot += av * bv;
    aSquared += av * av;
    bSquared += bv * bv;
  }
  return dot / Math.sqrt(aSquared * bSquared);
}

/**
 * Rank the categories for one picture. `embedding` and each of `vectors` come from the same image-and-text model.
 * Detector evidence (an aeroplane or a bird the detector found) nudges the matching categories up but can never decide alone.
 */
export function routeSubject(
  embedding: ArrayLike<number>, vectors: readonly ArrayLike<number>[], categories: readonly SubjectCategory[],
  detections: readonly DetectorEvidence[] = [], thresholds = ROUTER_THRESHOLDS,
): RouteResult {
  if (!categories.length || categories.length !== vectors.length) throw new RangeError('There must be exactly one vector per category.');
  if (!vectors.every((vector) => vector.length === embedding.length)) throw new RangeError('The picture and the categories use different vector sizes.');
  if (!Array.from(embedding).every(Number.isFinite) || !Array.from(embedding).some((value) => value !== 0)) throw new RangeError('The picture embedding is not a valid vector.');
  if (!vectors.every((vector) => Array.from(vector).every(Number.isFinite) && Array.from(vector).some((value) => value !== 0))) {
    throw new RangeError('Category vectors must be finite and nonzero.');
  }
  const logits = vectors.map((vector, index) => {
    let value = LOGIT_SCALE * cosine(embedding, vector);
    // The strongest supporting detection for this category counts, scaled by how sure the detector was.
    const support = detections
      .filter((detection) => Number.isFinite(detection.score) && detection.score >= thresholds.detectorMinimumScore && detection.score <= 1 && categories[index].detector.includes(detection.label))
      .reduce((best, detection) => Math.max(best, detection.score), 0);
    return value + thresholds.detectorBonus * support;
  });
  const top = Math.max(...logits);
  const weights = logits.map((value) => Math.exp(value - top));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const ranked: Ranked[] = weights.map((weight, index) => ({ category: categories[index], probability: weight / total }))
    .sort((a, b) => b.probability - a.probability);
  const probability = ranked[0].probability;
  const margin = probability - (ranked[1]?.probability ?? 0);
  const confident = probability >= thresholds.minimumProbability && margin >= thresholds.minimumMargin;
  const mass = (test: (category: SubjectCategory) => boolean) => ranked.filter((entry) => test(entry.category)).reduce((sum, entry) => sum + entry.probability, 0);
  return {
    category: confident ? ranked[0].category : null, best: ranked[0].category, probability, margin, confident, top: ranked.slice(0, 3),
    speciesProbability: mass((category) => category.group === 'animal' && category.identify === 'species'),
    animalProbability: mass((category) => category.group === 'animal'),
  };
}

/** What the species step may do for this picture. */
export type SpeciesGate = 'allow' | 'strict' | 'block';
/** How much of the probability must sit on "animal the species list covers" to allow, or off "animal" to block. */
export const GATE_MASS = { allow: 0.6, block: 0.6 } as const;
/**
 * Decided on the total probability of whole families of categories, not on the single best one: a bird photo may split
 * its probability across "bird", "bird of prey" and "waterbird" and is still clearly a bird.
 * 'allow': mostly a bird or mammal the species list can name. 'block': mostly something that is not an animal (a
 * helicopter, a car, a building), so no animal name is offered. 'strict': anything in between, including pets and farm
 * animals the list does not cover; a name is offered only if the species model is much more certain than usual.
 */
export function speciesGate(result: RouteResult | null): SpeciesGate {
  if (!result) return 'block'; // No independent category evidence: never infer a species from a closed animal-only list.
  if (result.speciesProbability >= GATE_MASS.allow) return 'allow';
  if (1 - result.animalProbability >= GATE_MASS.block) return 'block';
  return 'strict';
}

/** The extra certainty a species name needs from the species model when the gate is 'strict'. */
export const STRICT_SPECIES_PROBABILITY = 0.95;

/** Words for the user, in the same three steps as the species suggestions. */
export function routeWording(result: RouteResult): string {
  const percent = result.probability;
  // A large top score is not enough for a confident claim when the runner-up is close.
  // Keep the public wording aligned with the margin-aware route decision.
  return `${result.confident && percent >= 0.8 ? 'Likely' : percent >= 0.45 ? 'Possibly' : 'Unsure'} ${result.best.label.toLowerCase()}`;
}
