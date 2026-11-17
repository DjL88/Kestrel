/**
 * Conservative, offline-only recommendation policy.
 * This module does not write catalogue decisions or alter original photographs.
 * Detection scores are hints, not evidence that a photograph should be deleted.
 */
export type ReviewSubject = 'bird' | 'aircraft' | 'person' | 'mammal' | 'landscape' | 'unknown';
export type ReviewChoice = 'keep' | 'reject' | 'review';
export interface ReviewCandidate {
  id: string;
  subject: ReviewSubject;
  groupId?: string | null;
  quality?: number | null;
  confidence?: number | null;
  eyeDetected?: boolean | null;
  manualDecision?: 'keep' | 'reject' | null;
}
export interface ReviewSuggestion {
  id: string;
  suggestion: ReviewChoice;
  reason: 'manual' | 'best-in-group' | 'uncertain-detection' | 'candidate';
}

/**
 * High-recall policy: select one candidate per burst/subject group, and never
 * auto-reject an unreviewed image. Missing eye detection is not a negative
 * signal for aircraft, landscapes, or any uncertain detector result.
 */
export function recommendForReview(items: readonly ReviewCandidate[]): ReviewSuggestion[] {
  const best = new Map<string, { id: string; quality: number }>();
  for (const item of items) {
    if (item.manualDecision || !Number.isFinite(item.quality) ||
        !Number.isFinite(item.confidence) || (item.confidence ?? 0) < 0.6 ||
        (item.quality ?? -1) < 0 || (item.quality ?? 2) > 1 ||
        (item.confidence ?? 2) > 1) continue;
    const group = item.groupId?.trim() || item.id;
    const key = item.subject + ':' + group;
    const previous = best.get(key);
    if (!previous || (item.quality as number) > previous.quality) {
      best.set(key, { id: item.id, quality: item.quality as number });
    }
  }
  return items.map((item) => {
    if (item.manualDecision) return { id: item.id, suggestion: item.manualDecision, reason: 'manual' };
    const uncertain = !Number.isFinite(item.quality) || !Number.isFinite(item.confidence) ||
      (item.confidence ?? 0) < 0.6 || (item.confidence ?? 2) > 1 ||
      (item.quality ?? -1) < 0 || (item.quality ?? 2) > 1;
    if (uncertain) return { id: item.id, suggestion: 'review', reason: 'uncertain-detection' };
    const key = item.subject + ':' + (item.groupId?.trim() || item.id);
    if (best.get(key)?.id === item.id) return { id: item.id, suggestion: 'keep', reason: 'best-in-group' };
    return { id: item.id, suggestion: 'review', reason: 'candidate' };
  });
}
