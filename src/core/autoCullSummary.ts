import type { CullSuggestion } from './autoCull';

/**
 * Honest end-of-scan accounting. A keeper target is a ceiling for automatic
 * accepts, not permission to reject every other photograph.
 */
export function summarizeCullSuggestions(results: readonly CullSuggestion[]) {
  const automaticKeep = results.filter((result) => result.confidence === 'high' && result.decision === 'keep').length;
  const automaticDuplicate = results.filter((result) =>
    result.confidence === 'high' && result.decision === 'reject' && result.reason === 'duplicate').length;
  const otherHighReject = results.filter((result) =>
    result.confidence === 'high' && result.decision === 'reject' && result.reason !== 'duplicate').length;
  return {
    total: results.length,
    automaticKeep,
    automaticDuplicate,
    otherHighReject,
    needReview: results.length - automaticKeep - automaticDuplicate - otherHighReject,
  };
}
