import { countOriginalKeepers, isCullOriginal, limitAutoKeepers, type CullSuggestion } from '../../core/autoCull';
import { applyAutoCullDecisions, applyCullConfidence } from '../../core/cullingEngine';
import type { CullingState, PhotoFrame } from '../../core/types';
import { v2Text } from '../../i18n/areas/v2';
import type { PictureSource } from '../../core/pictureSource';
import { isRawPreviewFile } from '../../core/rawFormats';

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

/** The notice after a pass, in the person's language. Says plainly when RAWs were judged from the camera's own preview, not a sensor development. */
export function autoCullSummary(checked: number, rawFromCameraPreview: number): string {
  const words = v2Text.autoCullSummary;
  return [words.checked(checked), ...(rawFromCameraPreview > 0 ? [words.rawFromCameraPreview(rawFromCameraPreview)] : []), words.undo].join(' ');
}

/**
 * How many RAWs Auto-cull actually judged (not 'unavailable') from anything other than a picture developed from their
 * sensor data. `sources` holds what the preview provider recorded for the picture each photo was judged from
 * (core/pictureSource.ts); a photo with no record (for example an observation cached at import) counts as the camera's
 * preview, so the caveat is never left out.
 */
export function rawsJudgedFromCameraPreview(frames: readonly Pick<PhotoFrame, 'id' | 'filename'>[], results: readonly CullSuggestion[],
  sources: ReadonlyMap<string, PictureSource | undefined>): number {
  const judged = new Set(results.filter((result) => result.reason !== 'unavailable').map((result) => result.frameId));
  return frames.filter((frame) => judged.has(frame.id) && isRawPreviewFile(frame.filename)
    && sources.get(frame.id) !== 'raw-full' && sources.get(frame.id) !== 'raw-review').length;
}
