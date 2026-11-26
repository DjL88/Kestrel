import { hasReliableKeepEvidence, isCullOriginal, type Confidence, type CullReason, type CullSuggestion } from './autoCull';
import type { CullingState, PhotoFrame } from './types';
import { applyAutoCullDecisions } from './cullingEngine';

/**
 * Culling Assistant rules (x-std-cull-rules): minimum quality, keep at least N per burst and keep at most N per burst.
 * Pure and fast, so the list can be ranked again on every movement of a slider, from the stored observations
 * (src/core/cullObservationStore.ts) with no new scan.
 *
 * The rules only ever PROPOSE keepers, and only from positive photographic evidence. An uncertain photo (no trusted
 * subject, soft subject, unreadable preview, or a detector fallback) is always left for review: no rule can keep it,
 * and nothing here ever rejects a photo. "Keep at most" moves the extra frames of a burst to review, not to Trash.
 * Decisions the person made are left as they are and count towards their burst.
 */
export interface CullRules {
  /** 0 to 100: a photo needs at least this score to be proposed as a keeper on quality alone. */
  minQuality: number;
  /** 0 to 10: in each burst, the best frames with keeper evidence are proposed until this many are kept, even below the minimum. */
  keepAtLeast: number;
  /** 1 to 10: no more than this many keepers per burst; the rest stay for review. */
  keepAtMost: number;
}

export const DEFAULT_CULL_RULES: CullRules = { minQuality: 80, keepAtLeast: 1, keepAtMost: 2 };
export const CULL_RULE_LIMITS = { minQuality: [0, 100], keepAtLeast: [0, 10], keepAtMost: [1, 10] } as const;

const clamp = (value: unknown, [min, max]: readonly [number, number], fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/** Rules as given by a slider or read back from storage, made safe. "At least" never exceeds "at most". */
export function normaliseCullRules(rules: Partial<CullRules> | null | undefined): CullRules {
  const minQuality = clamp(rules?.minQuality, CULL_RULE_LIMITS.minQuality, DEFAULT_CULL_RULES.minQuality);
  const keepAtMost = clamp(rules?.keepAtMost, CULL_RULE_LIMITS.keepAtMost, DEFAULT_CULL_RULES.keepAtMost);
  const keepAtLeast = Math.min(keepAtMost, clamp(rules?.keepAtLeast, CULL_RULE_LIMITS.keepAtLeast, DEFAULT_CULL_RULES.keepAtLeast));
  return { minQuality, keepAtLeast, keepAtMost };
}

export type RuleOutcome = 'keep' | 'review' | 'copy';
/** Why a photo landed where it did, in words the interface can say (never a colour alone). */
export type RuleWhy =
  | 'meetsQuality' // proposed: at or above the minimum quality
  | 'burstMinimum' // proposed: below the minimum, but among the best of its burst and "keep at least" asks for it
  | 'belowQuality' // review: has keeper evidence, but under the minimum
  | 'burstFull' // review: good enough, but its burst already has "keep at most" keepers
  | 'uncertain' // review: no positive evidence; never proposed by any rule
  | 'copy' // a byte-identical copy of another photo
  | 'yourKeep' // the person kept it
  | 'yourChoice'; // the person decided something else (flag, set aside, reject); left alone

export interface RankedPhoto {
  frameId: string;
  score: number;
  confidence: Confidence;
  reason: CullReason;
  burstId: string | null;
  outcome: RuleOutcome;
  why: RuleWhy;
}

const OUTCOME_ORDER: Record<RuleOutcome, number> = { keep: 0, review: 1, copy: 2 };

/**
 * Rank every judged photo under the rules: proposed keepers first, then the photos for review, then copies; best
 * first within each. Photos with no judgement are left out (the caller says how many still need a scan).
 */
export function rankWithRules(frames: readonly PhotoFrame[], results: readonly CullSuggestion[], input: Partial<CullRules>): RankedPhoto[] {
  const rules = normaliseCullRules(input);
  const byId = new Map<string, CullSuggestion>();
  const ambiguous = new Set<string>();
  for (const result of results) {
    if (byId.has(result.frameId)) ambiguous.add(result.frameId);
    byId.set(result.frameId, result);
  }
  const ranked: RankedPhoto[] = [];
  const bursts = new Map<string, RankedPhoto[]>();
  for (const frame of frames) {
    const result = byId.get(frame.id);
    if (!result || ambiguous.has(frame.id) || !isCullOriginal(frame)) continue;
    const score = Number.isFinite(result.score) ? Math.min(100, Math.max(0, result.score)) : 0;
    const row: RankedPhoto = {
      frameId: frame.id, score, confidence: result.confidence, reason: result.reason, burstId: frame.burstGroupId ?? null,
      outcome: 'review', why: 'uncertain',
    };
    if (frame.decision === 'keep') { row.outcome = 'keep'; row.why = 'yourKeep'; }
    else if (frame.decision !== 'unreviewed') row.why = 'yourChoice';
    else if (result.reason === 'duplicate') { row.outcome = 'copy'; row.why = 'copy'; }
    else if (hasReliableKeepEvidence(result)) row.why = score >= rules.minQuality ? 'meetsQuality' : 'belowQuality';
    ranked.push(row);
    const key = row.burstId ?? `single:${frame.id}`;
    bursts.set(key, [...(bursts.get(key) ?? []), row]);
  }
  const best = (a: RankedPhoto, b: RankedPhoto) => b.score - a.score || a.frameId.localeCompare(b.frameId);
  for (const [key, rows] of bursts) {
    const single = key.startsWith('single:');
    let kept = rows.filter((row) => row.why === 'yourKeep').length;
    const limit = single ? 1 : rules.keepAtMost;
    const atLeast = single ? 0 : rules.keepAtLeast;
    for (const row of rows.filter((r) => r.why === 'meetsQuality').sort(best)) {
      if (kept < limit) { row.outcome = 'keep'; kept += 1; } else row.why = 'burstFull';
    }
    for (const row of rows.filter((r) => r.why === 'belowQuality').sort(best)) {
      if (kept >= atLeast || kept >= limit) break;
      row.outcome = 'keep'; row.why = 'burstMinimum'; kept += 1;
    }
  }
  return ranked.sort((a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] || best(a, b));
}

/** The photos the rules would newly keep: unreviewed, proposed, and never a copy or an uncertain one. */
export function proposedKeepers(ranked: readonly RankedPhoto[]): string[] {
  return ranked.filter((row) => row.outcome === 'keep' && (row.why === 'meetsQuality' || row.why === 'burstMinimum')).map((row) => row.frameId);
}

/** Keep the proposed photos as one step that Undo takes back. Only photos still unreviewed now are changed. */
export function applyCullRules(state: CullingState, ranked: readonly RankedPhoto[]): CullingState {
  const live = new Map(state.frames.map((frame) => [frame.id, frame]));
  const moves = proposedKeepers(ranked).filter((id) => {
    const frame = live.get(id);
    return frame && isCullOriginal(frame) && frame.decision === 'unreviewed';
  }).map((frameId) => ({ frameId, decision: 'keep' as const }));
  return moves.length ? applyAutoCullDecisions(state, moves) : state;
}
