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
  unsafeRejections: number;
  missingPredictions: number;
  byCategory: Record<CullBenchmarkCase['category'], {
    total: number; favourites: number; found: number; recall: number | null;
  }>;
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
  const counts = new Map<string, number>();
  for (const suggestion of suggestions) counts.set(suggestion.frameId, (counts.get(suggestion.frameId) ?? 0) + 1);
  const byId = new Map(suggestions.map((item) => [item.frameId, item]));
  let favourites = 0, foundFavourites = 0, suggested = 0, correctSuggestions = 0;
  let unsafeRejections = 0, missingPredictions = 0;
  const seen = new Set<string>();
  for (const label of labels) {
    if (seen.has(label.id)) throw new Error('Duplicate benchmark label: ' + label.id);
    seen.add(label.id);
    if (!byCategory[label.category]) throw new Error('Unknown benchmark category: ' + label.category);
    const bucket = byCategory[label.category];
    bucket.total += 1;
    if (label.favourite) { favourites += 1; bucket.favourites += 1; }
    const prediction = counts.get(label.id) === 1 ? byId.get(label.id) : undefined;
    if (!prediction) missingPredictions += 1;
    // An unknown result remains in human review; a confident reject is excluded.
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
    unsafeRejections, missingPredictions, byCategory,
  };
}
