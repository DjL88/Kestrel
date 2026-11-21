import type { CullSuggestion } from './autoCull';
import { missingDetectorReviewFallback, restoreNoSubjectFallback } from './cullFallback';

/**
 * Keep duplicate hashing and preview/model analysis separate, but execute
 * them at the same time. Each producer has its own bounded concurrency.
 * Both must succeed before any final keeper/reject result is emitted.
 */
export async function collectCullEvidence<T>(
  analyse: () => Promise<T>,
  identifyDuplicates: () => Promise<ReadonlySet<string>>,
): Promise<{ analysis: T; duplicates: ReadonlySet<string> }> {
  // Start both before awaiting either; Promise.all also observes rejection
  // from both producers, including when Stop aborts one of them.
  const analysisPromise = analyse();
  const duplicatePromise = identifyDuplicates();
  const [analysis, duplicates] = await Promise.all([analysisPromise, duplicatePromise]);
  return { analysis, duplicates };
}

/**
 * Finalise only after all evidence is complete. Exact byte duplicates have
 * a deterministic reject independent of lane completion; an unavailable
 * preview or detector failure cannot revoke that byte-identical evidence.
 *
 * Subject-fallback population counts exclude duplicates, matching the
 * historical fast path which skipped preview analysis for those files.
 */
export function finaliseCullEvidence(
  candidateIds: readonly string[],
  resultsById: ReadonlyMap<string, CullSuggestion>,
  duplicates: ReadonlySet<string>,
  previewScores: ReadonlyMap<string, CullSuggestion>,
  detectorHealthy: boolean,
): CullSuggestion[] {
  const results = candidateIds.map((frameId): CullSuggestion => {
    if (duplicates.has(frameId)) {
      return { frameId, decision: 'reject', confidence: 'high', score: 100, reason: 'duplicate' };
    }
    return resultsById.get(frameId) ??
      { frameId, decision: null, confidence: 'low', score: 0, reason: 'unavailable' };
  });

  const eligible = results.filter((result) => result.reason !== 'duplicate' && previewScores.has(result.frameId));
  const withSubject = eligible.filter((result) => result.reason !== 'noSubject').length;
  const fallback = !detectorHealthy
    ? missingDetectorReviewFallback(results, previewScores)
    : eligible.length > 0 && withSubject / eligible.length < 0.15
      ? restoreNoSubjectFallback(results, previewScores)
      : results;
  return fallback;
}
