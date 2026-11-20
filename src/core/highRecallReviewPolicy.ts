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
  /** Optional raw local-detector evidence; never a calibrated probability. */
  competingEvidence?: { birdScore: number; aircraftScore: number; modelVersion: string } | null;
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
  const manuallyKeptGroups = new Set<string>();
  const identityCounts = new Map<string, number>();
  for (const item of items) identityCounts.set(item.id, (identityCounts.get(item.id) ?? 0) + 1);
  const validSubjects: readonly ReviewSubject[] = ['bird', 'aircraft', 'person', 'mammal', 'landscape'];
  // Conservative contradiction gate, NOT a measured accuracy threshold.
  // Legacy callers without paired detector outputs retain existing behaviour.
  const conflicts = (item: ReviewCandidate): boolean => {
    const e = item.competingEvidence;
    if (e === undefined || e === null) return false;
    if (typeof e.modelVersion !== 'string' || !e.modelVersion.trim() ||
        !Number.isFinite(e.birdScore) || !Number.isFinite(e.aircraftScore) ||
        e.birdScore < 0 || e.birdScore > 1 || e.aircraftScore < 0 || e.aircraftScore > 1)
      return true;
    if (item.subject === 'bird' && e.aircraftScore >= 0.55 &&
        e.aircraftScore >= e.birdScore - 0.15) return true;
    if (item.subject === 'aircraft' && e.birdScore >= 0.55 &&
        e.birdScore >= e.aircraftScore - 0.15) return true;
    return false;
  };
  const eligible = (item: ReviewCandidate): boolean =>
    typeof item.id === 'string' && item.id.trim().length > 0 &&
    identityCounts.get(item.id) === 1 && validSubjects.includes(item.subject) && !conflicts(item) &&
    (item.groupId == null || (typeof item.groupId === 'string' && item.groupId.trim().length > 0)) &&
    Number.isFinite(item.quality) && Number.isFinite(item.confidence) &&
    (item.confidence as number) >= 0.6 && (item.confidence as number) <= 1 &&
    (item.quality as number) >= 0 && (item.quality as number) <= 1;
  const groupKey = (item: ReviewCandidate): string =>
    JSON.stringify([item.subject, typeof item.groupId === 'string' ? (item.groupId.trim() || item.id) : item.id]);
  // A manual keeper already satisfies the group's keeper requirement. Do not
  // silently nominate another image in the same burst after a rescan.
  for (const item of items) {
    if (item.manualDecision === 'keep' && typeof item.id === 'string' && item.id.trim().length > 0 &&
        identityCounts.get(item.id) === 1 && validSubjects.includes(item.subject) &&
        (item.groupId == null || (typeof item.groupId === 'string' && item.groupId.trim().length > 0))) {
      manuallyKeptGroups.add(groupKey(item));
    }
  }
  for (const item of items) {
    if (item.manualDecision != null || !eligible(item) || manuallyKeptGroups.has(groupKey(item))) continue;
    const key = groupKey(item);
    const previous = best.get(key);
    if (!previous || (item.quality as number) > previous.quality ||
        ((item.quality as number) === previous.quality && item.id < previous.id)) {
      best.set(key, { id: item.id, quality: item.quality as number });
    }
  }
  return items.map((item) => {
    // An ambiguous catalogue identity cannot safely inherit a manual decision.
    // Never attribute a Keep or Reject to two different originals sharing an ID.
    if (typeof item.id !== 'string' || !item.id.trim() || identityCounts.get(item.id) !== 1) {
      return { id: item.id, suggestion: 'review', reason: 'uncertain-detection' };
    }
    if (item.manualDecision === 'keep' || item.manualDecision === 'reject') {
      return { id: item.id, suggestion: item.manualDecision, reason: 'manual' };
    }
    // Persisted catalogue data can contain obsolete or malformed decisions.
    // Never promote these into a Keep or silently treat them as unreviewed.
    if (item.manualDecision != null) {
      return { id: item.id, suggestion: 'review', reason: 'uncertain-detection' };
    }
    const uncertain = !eligible(item);
    if (uncertain) return { id: item.id, suggestion: 'review', reason: 'uncertain-detection' };
    const key = groupKey(item);
    if (best.get(key)?.id === item.id) return { id: item.id, suggestion: 'keep', reason: 'best-in-group' };
    return { id: item.id, suggestion: 'review', reason: 'candidate' };
  });
}
