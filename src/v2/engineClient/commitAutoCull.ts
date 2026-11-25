import { countOriginalKeepers, isCullOriginal, limitAutoKeepers, type CullSuggestion } from '../../core/autoCull';
import { applyAutoCullDecisions, applyCullConfidence } from '../../core/cullingEngine';
import type { CullingState, PhotoFrame } from '../../core/types';

/** Check the live catalogue and keeper budget again after background analysis. */
export function commitAutoCull(
  state: CullingState, examined: readonly PhotoFrame[], results: readonly CullSuggestion[],
): CullingState {
  // Never attach a scan result to an ambiguous identity (including duplicates
  // in the captured snapshot, not just the live catalogue).
  const uniqueFrames = (frames: readonly PhotoFrame[]) => {
    const index = new Map<string, PhotoFrame>();
    const ambiguous = new Set<string>();
    for (const frame of frames) {
      if (index.has(frame.id)) ambiguous.add(frame.id);
      index.set(frame.id, frame);
    }
    for (const id of ambiguous) index.delete(id);
    return index;
  };
  const sources = uniqueFrames(examined);
  const current = uniqueFrames(state.frames);
  const eligible = results.filter(({ frameId }) => {
    const before = sources.get(frameId), after = current.get(frameId);
    return after && before && isCullOriginal(after) && after.decision === 'unreviewed' && before.stableKey === after.stableKey &&
      before.originalSha256 === after.originalSha256;
  });
  const keepers = countOriginalKeepers(state.frames);
  const final = limitAutoKeepers(eligible, state.frames, state.keeperTarget - keepers);
  const scored = applyCullConfidence(state, final);
  return applyAutoCullDecisions(scored, final
    .filter((result) => result.decision === 'keep' && result.confidence === 'high')
    .map((result) => ({ frameId: result.frameId, decision: 'keep' })));
}

/** The notice after a pass. Says plainly when RAWs were judged from the camera's own preview, not a sensor development. */
export function autoCullSummary(checked: number, rawFromCameraPreview: number): string {
  const head = `Auto-cull checked ${checked} photo${checked === 1 ? '' : 's'}. Review the flags in the filmstrip.`;
  const raw = rawFromCameraPreview > 0
    ? ` ${rawFromCameraPreview} RAW photo${rawFromCameraPreview === 1 ? ' was' : 's were'} judged from the camera's embedded preview, not InFlight's development of ${rawFromCameraPreview === 1 ? 'its' : 'their'} sensor data, so check sharpness there by eye.`
    : '';
  return `${head}${raw} You can undo the whole pass in one step.`;
}
