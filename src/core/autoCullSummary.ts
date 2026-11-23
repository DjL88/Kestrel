import type { CullSuggestion } from './autoCull';

/**
 * Count photographs, not worker messages. Overlapping scans can report the
 * same frame more than once; disagreement must remain visible for review.
 * A keeper target is a ceiling, never permission to reject the remainder.
 */
export function summarizeCullSuggestions(results: readonly CullSuggestion[]) {
  const byFrame = new Map<string, 'keep' | 'duplicate' | 'otherReject' | 'review'>();
  let unidentified = 0;
  for (const result of results) {
    // Without a stable identity we cannot safely deduplicate or auto-decide.
    if (typeof result.frameId !== 'string' || !result.frameId.trim()) {
      unidentified++;
      continue;
    }
    // A malformed worker score is not evidence of a confident decision.
    const validScore = Number.isFinite(result.score) && result.score >= 0 && result.score <= 100;
    const outcome = validScore && result.confidence === 'high' && result.decision === 'keep'
      ? 'keep'
      : validScore && result.confidence === 'high' && result.decision === 'reject'
        ? result.reason === 'duplicate' ? 'duplicate' : 'otherReject'
        : 'review';
    const previous = byFrame.get(result.frameId);
    // Once a frame is disputed, later messages cannot restore an automatic
    // decision merely by arriving last.
    byFrame.set(result.frameId, previous === undefined ? outcome
      : previous === outcome ? outcome : 'review');
  }
  const values = [...byFrame.values()];
  const automaticKeep = values.filter((outcome) => outcome === 'keep').length;
  const automaticDuplicate = values.filter((outcome) => outcome === 'duplicate').length;
  const otherHighReject = values.filter((outcome) => outcome === 'otherReject').length;
  return {
    total: values.length + unidentified,
    automaticKeep,
    automaticDuplicate,
    otherHighReject,
    needReview: values.length + unidentified - automaticKeep - automaticDuplicate - otherHighReject,
  };
}
