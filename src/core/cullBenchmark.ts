import type { CullSuggestion } from './autoCull';

/** Photographer-labelled, per-shoot benchmark. These labels are ground truth, not model predictions. */
export interface CullBenchmarkCase {
  id: string;
  category: 'birds' | 'aircraft' | 'people' | 'mammals' | 'landscapes';
  /** True if the photographer would want this image included in review/shortlist. */
  favourite: boolean;
  /** Optional: only label genuinely unusable images, not merely non-favourites. */
  unusable?: boolean;
}

export interface CullBenchmarkResult {
  total: number;
  favourites: number;
  suggested: number;
  foundFavourites: number;
  missedFavourites: number;
  recall: number | null;
  precision: number | null;
  /** Precision of explicit auto-Keep decisions only, excluding reviewable unknowns. */
  autoKeepPrecision: number | null;
  autoKeeps: number;
  correctAutoKeeps: number;
  unsafeRejections: number;
  missingPredictions: number;
  /** Predictions that do not belong to the labelled shoot. */
  unexpectedPredictions: number;
  /** Repeated prediction IDs: excluded from confident decisions. */
  duplicatePredictions: number;
  /** Invalid predictions: excluded from confident decisions. */
  invalidPredictions: number;
  byCategory: Record<CullBenchmarkCase['category'], {
    total: number; favourites: number; found: number; recall: number | null;
  }>;
}

/** Treat untrusted detector payloads as reviewable, never confident rejects. */
export function isValidCullBenchmarkPrediction(value: CullSuggestion): boolean {
  return (value.decision === 'keep' || value.decision === 'reject' || value.decision === null) &&
    (value.confidence === 'low' || value.confidence === 'medium' || value.confidence === 'high') &&
    typeof value.score === 'number' && Number.isFinite(value.score) &&
    value.score >= 0 && value.score <= 100;
}

/**
 * Evaluate high-recall review recommendations. Any non-reject recommendation
 * (including an honest low-confidence undecided frame) is retained for review.
 * Missing or duplicated predictions are treated as unknown, never as rejects.
 * This does not measure real-world performance without real photographer labels.
 */
export function evaluateCullBenchmark(
  labels: readonly CullBenchmarkCase[], suggestions: readonly CullSuggestion[],
): CullBenchmarkResult {
  const categories: CullBenchmarkCase['category'][] = ['birds', 'aircraft', 'people', 'mammals', 'landscapes'];
  const byCategory = Object.fromEntries(categories.map((category) => [category,
    { total: 0, favourites: 0, found: 0, recall: null as number | null },
  ])) as CullBenchmarkResult['byCategory'];
  const labelIds = new Set(labels.map((label) => label.id));
  const counts = new Map<string, number>();
  let unexpectedPredictions = 0;
  for (const suggestion of suggestions) {
    if (!labelIds.has(suggestion.frameId)) { unexpectedPredictions += 1; continue; }
    counts.set(suggestion.frameId, (counts.get(suggestion.frameId) ?? 0) + 1);
  }
  const byId = new Map(suggestions.map((item) => [item.frameId, item]));
  const duplicatePredictions = [...counts.values()].filter((count) => count > 1).length;
  let invalidPredictions = 0;
  let favourites = 0, foundFavourites = 0, suggested = 0, correctSuggestions = 0;
  let unsafeRejections = 0, missingPredictions = 0;
  let autoKeeps = 0, correctAutoKeeps = 0;
  const seen = new Set<string>();
  for (const label of labels) {
    if (typeof label.id !== 'string' || !label.id.trim()) throw new Error('Invalid benchmark label ID');
    if (seen.has(label.id)) throw new Error('Duplicate benchmark label: ' + label.id);
    if (typeof label.favourite !== 'boolean') throw new Error('Invalid benchmark favourite flag');
    if (label.unusable !== undefined && typeof label.unusable !== 'boolean') throw new Error('Invalid benchmark unusable flag');
    if (label.favourite && label.unusable) throw new Error('Contradictory favourite and unusable labels');
    seen.add(label.id);
    if (!byCategory[label.category]) throw new Error('Unknown benchmark category: ' + label.category);
    const bucket = byCategory[label.category];
    bucket.total += 1;
    if (label.favourite) { favourites += 1; bucket.favourites += 1; }
    const rawPrediction = counts.get(label.id) === 1 ? byId.get(label.id) : undefined;
    const valid = rawPrediction && isValidCullBenchmarkPrediction(rawPrediction);
    if (rawPrediction && !valid) invalidPredictions += 1;
    const prediction = valid ? rawPrediction : undefined;
    if (!prediction) missingPredictions += 1;
    // An unknown result remains in human review; a confident reject is excluded.
    if (prediction?.decision === 'keep') {
      autoKeeps += 1;
      if (label.favourite) correctAutoKeeps += 1;
    }
    const retained = !prediction || prediction.decision !== 'reject';
    if (retained) {
      suggested += 1;
      if (label.favourite) { foundFavourites += 1; bucket.found += 1; correctSuggestions += 1; }
    } else if (label.favourite) unsafeRejections += 1;
  }
  for (const category of categories) {
    const bucket = byCategory[category];
    bucket.recall = bucket.favourites ? bucket.found / bucket.favourites : null;
  }
  return {
    total: labels.length, favourites, suggested, foundFavourites,
    missedFavourites: favourites - foundFavourites,
    recall: favourites ? foundFavourites / favourites : null,
    precision: suggested ? correctSuggestions / suggested : null,
    autoKeepPrecision: autoKeeps ? correctAutoKeeps / autoKeeps : null,
    autoKeeps, correctAutoKeeps,
    unsafeRejections, missingPredictions, unexpectedPredictions,
    duplicatePredictions, invalidPredictions, byCategory,
  };
}
