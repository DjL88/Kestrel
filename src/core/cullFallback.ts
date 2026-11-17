import type { CullSuggestion } from './autoCull';

/**
 * When the detector recognises almost no subjects (for example landscapes or
 * aircraft it does not recognise), preview detail remains useful for review.
 * It is not evidence that the intended subject is sharp: never promote that
 * fallback into an automatic keeper.
 */
export function restoreNoSubjectFallback(
  results: CullSuggestion[],
  baseById: ReadonlyMap<string, CullSuggestion>,
): CullSuggestion[] {
  return results.map((result) => {
    if (result.reason !== 'noSubject') return result;
    const base = baseById.get(result.frameId);
    if (!base) return result;
    return {
      ...base,
      decision: null,
      confidence: base.confidence === 'high' ? 'medium' : base.confidence,
      score: Math.min(79, base.score),
    };
  });
}

/**
 * Preview-only cloud IDEs can lack the large local subject-detection model.
 * Exact byte-identical duplicates remain safe to recognise, but image texture
 * must not produce automatic keep/reject decisions without subject evidence.
 * Keep usable preview scores as medium-confidence *suggestions* for review.
 */
export function missingDetectorReviewFallback(
  results: readonly CullSuggestion[],
  baseById: ReadonlyMap<string, CullSuggestion>,
): CullSuggestion[] {
  const uncertain = results.map((result): CullSuggestion =>
    result.reason === 'duplicate' || result.reason === 'unavailable'
      ? result
      : { ...result, decision: null, confidence: 'low', reason: 'noSubject' });
  return restoreNoSubjectFallback(uncertain, baseById);
}
