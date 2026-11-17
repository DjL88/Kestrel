import type { CullingState } from './types';

export type ReviewAuditIssueCode =
  | 'duplicate-id' | 'duplicate-original' | 'invalid-selection'
  | 'invalid-compare' | 'removed-selection' | 'removed-compare'
  | 'invalid-decision' | 'history-missing' | 'history-ambiguous'
  | 'history-removed';

export interface ReviewAuditIssue {
  code: ReviewAuditIssueCode;
  /** Stable catalogue identity, never a path or image payload. */
  frameId?: string;
}

export interface ReviewSessionAudit {
  active: number;
  reviewed: number;
  keep: number;
  reject: number;
  unreviewed: number;
  /** Conservative count of review decisions requiring human attention. */
  issues: ReviewAuditIssue[];
  safeForAutomaticDecisions: boolean;
}

/**
 * Read-only integrity preflight for an offline culling session.
 * Does not mutate catalogue, edit history, RAW originals, or review decisions.
 * Reports invalid identities rather than silently choosing a duplicate.
 */
export function auditReviewSession(state: CullingState): ReviewSessionAudit {
  const issues: ReviewAuditIssue[] = [];
  const counts = new Map<string, number>();
  const originals = new Map<string, string>();
  let active = 0, keep = 0, reject = 0, unreviewed = 0;

  for (const frame of state.frames) {
    counts.set(frame.id, (counts.get(frame.id) ?? 0) + 1);
    if (!frame.id || typeof frame.id !== 'string') issues.push({ code: 'duplicate-id', frameId: String(frame.id) });
    if (frame.removedAt !== undefined && frame.removedAt !== null) continue;
    active++;
    if (frame.decision === 'keep') keep++;
    else if (frame.decision === 'reject') reject++;
    else if (frame.decision === 'unreviewed') unreviewed++;
    else issues.push({ code: 'invalid-decision', frameId: frame.id });
    // Two active frames with the same original key are not safe to auto-classify.
    if (frame.stableKey && !frame.virtualCopy) {
      const prior = originals.get(frame.stableKey);
      if (prior !== undefined) issues.push({ code: 'duplicate-original', frameId: frame.id });
      else originals.set(frame.stableKey, frame.id);
    }
  }
  for (const [id, count] of counts) {
    if (count > 1) issues.push({ code: 'duplicate-id', frameId: id });
  }
  const byId = new Map(state.frames.map((frame) => [frame.id, frame]));
  for (const [id, invalid, removed] of [
    [state.selectedFrameId, 'invalid-selection', 'removed-selection'],
    [state.compareRightFrameId, 'invalid-compare', 'removed-compare'],
  ] as const) {
    if (id === null) continue;
    if (counts.get(id) !== 1) issues.push({ code: invalid, frameId: id });
    else if (byId.get(id)?.removedAt !== undefined && byId.get(id)?.removedAt !== null) issues.push({ code: removed, frameId: id });
  }
  for (const entry of [...state.undoStack, ...state.redoStack]) {
    for (const change of entry.batch ?? [entry]) {
      if (counts.get(change.frameId) === undefined) {
        issues.push({ code: 'history-missing', frameId: change.frameId });
      } else if (counts.get(change.frameId) !== 1) {
        issues.push({ code: 'history-ambiguous', frameId: change.frameId });
      } else if (byId.get(change.frameId)?.removedAt !== undefined && byId.get(change.frameId)?.removedAt !== null && !entry.removal) {
        issues.push({ code: 'history-removed', frameId: change.frameId });
      }
    }
  }
  return {
    active, keep, reject, unreviewed, reviewed: keep + reject,
    issues,
    safeForAutomaticDecisions: issues.length === 0,
  };
}
