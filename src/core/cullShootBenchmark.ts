import type { PhotoFrame } from './types';
import type { CullSuggestion } from './autoCull';
import { evaluateCullBenchmark, isValidCullBenchmarkPrediction, type CullBenchmarkCase, type CullBenchmarkResult } from './cullBenchmark';

/** Photographer-supplied labels; never inferred from the model's own decisions. */
export interface PhotographerLabel {
  stableKey: string;
  category: CullBenchmarkCase['category'];
  favourite: boolean;
  unusable?: boolean;
}

export interface ShootBenchmarkReport {
  result: CullBenchmarkResult;
  /** Stable keys of favourite photos that an automated reject would exclude. */
  missedFavouriteKeys: string[];
  /** Missing/duplicate predictions are reported as coverage gaps, not failures of subject detection. */
  predictionCoverage: number;
}

/**
 * Evaluate a complete real shoot against independent photographer labels.
 * Requires exactly one label per active original and a unique stableKey/frame ID.
 * Fails rather than reporting deceptively good metrics for partially labelled shoots.
 */
export function benchmarkShoot(
  frames: readonly PhotoFrame[], labels: readonly PhotographerLabel[], suggestions: readonly CullSuggestion[],
): ShootBenchmarkReport {
  const active = frames.filter((frame) => frame.removedAt == null && !frame.virtualCopy && !frame.isDemo);
  const byKey = new Map<string, PhotographerLabel>();
  for (const label of labels) {
    if (!label.stableKey || byKey.has(label.stableKey)) throw new Error('Duplicate or missing photographer label key');
    if (typeof label.favourite !== 'boolean') throw new Error('Invalid photographer favourite label');
    if (label.unusable !== undefined && typeof label.unusable !== 'boolean') throw new Error('Invalid photographer unusable label');
    if (label.favourite && label.unusable) throw new Error('Contradictory photographer labels');
    byKey.set(label.stableKey, label);
  }
  const keys = new Set<string>();
  const ids = new Set<string>();
  const cases: CullBenchmarkCase[] = [];
  for (const frame of active) {
    if (!frame.stableKey || !frame.id || keys.has(frame.stableKey) || ids.has(frame.id)) {
      throw new Error('Ambiguous shoot photo identity');
    }
    keys.add(frame.stableKey);
    ids.add(frame.id);
    const label = byKey.get(frame.stableKey);
    if (!label) throw new Error('Missing photographer label for ' + frame.stableKey);
    cases.push({ id: frame.id, category: label.category, favourite: label.favourite, unusable: label.unusable });
  }
  if (keys.size !== byKey.size) throw new Error('Photographer labels contain photos outside the active shoot');
  const counts = new Map<string, number>();
  for (const item of suggestions) counts.set(item.frameId, (counts.get(item.frameId) ?? 0) + 1);
  const byId = new Map(suggestions.map((item) => [item.frameId, item]));
  const missedFavouriteKeys = active.filter((frame) => byKey.get(frame.stableKey)?.favourite &&
    counts.get(frame.id) === 1 && byId.get(frame.id) !== undefined &&
    isValidCullBenchmarkPrediction(byId.get(frame.id)!) && byId.get(frame.id)?.decision === 'reject').map((frame) => frame.stableKey);
  const result = evaluateCullBenchmark(cases, suggestions);
  return {
    result,
    missedFavouriteKeys,
    predictionCoverage: active.length ? (active.length - result.missingPredictions) / active.length : 0,
  };
}
