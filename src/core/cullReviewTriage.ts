/** Deterministic, offline-only review ordering. Never changes a photo decision. */
export interface ReviewCandidate {
  id: string;
  decision: 'keep' | 'reject' | 'unreviewed';
  removedAt?: number | null;
  isDemo?: boolean;
  virtualCopy?: boolean;
  burstGroupId?: string | null;
  suggestion?: {
    decision: 'keep' | 'reject' | null;
    confidence: 'high' | 'medium' | 'low';
    score: number;
    reason?: string;
  } | null;
}
export interface ReviewTriage {
  id: string;
  priority: 'urgent' | 'review' | 'routine';
  reason: 'possibleFalseReject' | 'uncertain' | 'burstAlternative' | 'unscored' | 'suggestedKeep';
}
/**
 * Review risky proposed rejections first; missing/invalid predictions are never
 * treated as rejection evidence. Stable input ordering avoids UI jumping.
 */
export function triageCullReview(frames: readonly ReviewCandidate[]): ReviewTriage[] {
  const burstKeepers = new Set(frames.filter(f => f.removedAt == null && f.decision === 'keep' && f.burstGroupId).map(f => f.burstGroupId));
  const seen = new Set<string>();
  const result: ReviewTriage[] = [];
  for (const frame of frames) {
    if (!frame.id || seen.has(frame.id) || frame.removedAt != null || frame.decision !== 'unreviewed' || frame.virtualCopy || frame.isDemo) continue;
    seen.add(frame.id);
    const s = frame.suggestion;
    const valid = s && Number.isFinite(s.score) && s.score >= 0 && s.score <= 100;
    let priority: ReviewTriage['priority'] = 'review';
    let reason: ReviewTriage['reason'] = 'unscored';
    if (!s || !valid) { priority = 'urgent'; reason = 'unscored'; }
    else if (s.decision === 'reject') { priority = 'urgent'; reason = 'possibleFalseReject'; }
    else if (s.decision === null || s.confidence === 'low') { priority = 'urgent'; reason = 'uncertain'; }
    else if (frame.burstGroupId && burstKeepers.has(frame.burstGroupId)) { reason = 'burstAlternative'; }
    else if (s.decision === 'keep') { priority = 'routine'; reason = 'suggestedKeep'; }
    result.push({ id: frame.id, priority, reason });
  }
  const rank = { urgent: 0, review: 1, routine: 2 };
  return result.sort((a, b) => rank[a.priority] - rank[b.priority]);
}
