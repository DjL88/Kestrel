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
  const manuallyKeptGroups = new Set<string>();
  const identityCounts = new Map<string, number>();
  for (const item of items) identityCounts.set(item.id, (identityCounts.get(item.id) ?? 0) + 1);
  const validSubjects: readonly ReviewSubject[] = ['bird', 'aircraft', 'person', 'mammal', 'landscape'];
  const eligible = (item: ReviewCandidate): boolean =>
    typeof item.id === 'string' && item.id.trim().length > 0 &&
    identityCounts.get(item.id) === 1 && validSubjects.includes(item.subject) &&
    (item.groupId == null || (typeof item.groupId === 'string' && item.groupId.trim().length > 0)) &&
    Number.isFinite(item.quality) && Number.isFinite(item.confidence) &&
    (item.confidence as number) >= 0.6 && (item.confidence as number) <= 1 &&
    (item.quality as number) >= 0 && (item.quality as number) <= 1;
  const groupKey = (item: ReviewCandidate): string =>
    JSON.stringify([item.subject, typeof item.groupId === 'string' ? (item.groupId.trim() || item.id) : item.id]);
  // A manual keeper already satisfies the group's keeper requirement. Do not
  // silently nominate another image in the same burst after a rescan.
  for (const item of items) {
    if (item.manualDecision === 'keep' && eligible(item)) manuallyKeptGroups.add(groupKey(item));
  }
  for (const item of items) {
    if (item.manualDecision || !eligible(item) || manuallyKeptGroups.has(groupKey(item))) continue;
    const key = groupKey(item);
    const previous = best.get(key);
    if (!previous || (item.quality as number) > previous.quality) {
      best.set(key, { id: item.id, quality: item.quality as number });
    }
  }
  return items.map((item) => {
    if (item.manualDecision) return { id: item.id, suggestion: item.manualDecision, reason: 'manual' };
    const uncertain = !eligible(item);
    if (uncertain) return { id: item.id, suggestion: 'review', reason: 'uncertain-detection' };
    const key = groupKey(item);
    if (best.get(key)?.id === item.id) return { id: item.id, suggestion: 'keep', reason: 'best-in-group' };
    return { id: item.id, suggestion: 'review', reason: 'candidate' };
  });
}
