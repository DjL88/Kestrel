import type { CullSuggestion } from './autoCull';

/**
 * Count photographs, not worker messages. Overlapping scans can report the
 * same frame more than once; disagreement must remain visible for review.
 * A keeper target is a ceiling, never permission to reject the remainder.
 */
export function summarizeCullSuggestions(results: readonly CullSuggestion[]) {
  const byFrame = new Map<string, 'keep' | 'duplicate' | 'otherReject' | 'review'>();
  for (const result of results) {
    const outcome = result.confidence === 'high' && result.decision === 'keep'
      ? 'keep'
      : result.confidence === 'high' && result.decision === 'reject'
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
    total: values.length,
    automaticKeep,
    automaticDuplicate,
    otherHighReject,
    needReview: values.length - automaticKeep - automaticDuplicate - otherHighReject,
  };
}
