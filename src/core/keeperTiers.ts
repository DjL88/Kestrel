import type { CullSuggestion } from './autoCull';
import type { PhotoFrame } from './types';

/**
 * Three *advisory* keeper tiers. The scores are relative culling signals, not
 * calibrated photographic quality probabilities. Expanding a tier never auto-
 * deletes anything, and suggestions require an explicit Keep action.
 */
export type KeeperTier = 'best' | 'better' | 'good';
const scoreFloor: Record<KeeperTier, number> = { best: 90, better: 75, good: 55 };

export function planKeeperTier(
  results: readonly CullSuggestion[],
  frames: readonly PhotoFrame[],
  target: number,
  tier: KeeperTier,
): { frameId: string; decision: 'keep' }[] {
  if (!Number.isSafeInteger(target) || target < 1 || target > 9999) return [];
  const remaining = Math.max(0, target - frames.filter((frame) => frame.removedAt == null && frame.decision === 'keep').length);
  if (!remaining) return [];

  const byId = new Map<string, PhotoFrame>();
  const ambiguous = new Set<string>();
  for (const frame of frames) {
    if (byId.has(frame.id)) ambiguous.add(frame.id);
    else byId.set(frame.id, frame);
  }
  const occupied = new Set(frames
    .filter((frame) => frame.removedAt == null && frame.decision === 'keep' && frame.burstGroupId)
    .map((frame) => frame.burstGroupId!));
  const claimed = new Set<string>();
  const choices: { frameId: string; decision: 'keep' }[] = [];
  const eligible = [...results].filter((result) =>
    result.decision === 'keep' &&
    (result.confidence === 'high' || (tier !== 'best' && result.confidence === 'medium')) &&
    Number.isFinite(result.score) && result.score >= scoreFloor[tier] && result.score <= 100 &&
    result.reason !== 'unavailable' && result.reason !== 'duplicate' && result.reason !== 'flat');
  // Stable ties regardless of import order, and no extra selection within a
  // burst that already has a keeper (manual or from a previous scan).
  eligible.sort((a, b) => b.score - a.score || a.frameId.localeCompare(b.frameId));
  for (const result of eligible) {
    if (choices.length >= remaining) break;
    if (claimed.has(result.frameId) || ambiguous.has(result.frameId)) continue;
    const frame = byId.get(result.frameId);
    if (!frame || frame.removedAt != null || frame.decision !== 'unreviewed' || frame.isDemo || frame.virtualCopy) continue;
    if (frame.burstGroupId && occupied.has(frame.burstGroupId)) continue;
    claimed.add(result.frameId);
    if (frame.burstGroupId) occupied.add(frame.burstGroupId);
    choices.push({ frameId: frame.id, decision: 'keep' });
  }
  return choices;
}
