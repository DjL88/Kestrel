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
      confidence: base.confidence === 'high' ? 'medium' : base.confidence,
      score: Math.min(79, base.score),
    };
  });
}
