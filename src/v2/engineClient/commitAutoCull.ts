import { limitAutoKeepers, type CullSuggestion } from '../../core/autoCull';
import { applyAutoCullDecisions, applyCullConfidence } from '../../core/cullingEngine';
import type { CullingState, PhotoFrame } from '../../core/types';

/** Check the live catalogue and keeper budget again after background analysis. */
export function commitAutoCull(
  state: CullingState, examined: readonly PhotoFrame[], results: readonly CullSuggestion[],
): CullingState {
  const sources = new Map(examined.map((frame) => [frame.id, frame]));
  const current = new Map(state.frames.map((frame) => [frame.id, frame]));
  const eligible = results.filter(({ frameId }) => {
    const before = sources.get(frameId), after = current.get(frameId);
    return after && before && after.removedAt == null && after.decision === 'unreviewed' &&
      !after.isDemo && !after.virtualCopy && before.stableKey === after.stableKey &&
      before.originalSha256 === after.originalSha256;
  });
  const keepers = state.frames.filter((frame) => frame.removedAt == null && frame.decision === 'keep').length;
  const final = limitAutoKeepers(eligible, state.frames, state.keeperTarget - keepers);
  const scored = applyCullConfidence(state, final);
  return applyAutoCullDecisions(scored, final
    .filter((result) => result.decision === 'keep' && result.confidence === 'high')
    .map((result) => ({ frameId: result.frameId, decision: 'keep' })));
}
