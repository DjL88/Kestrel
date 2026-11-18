import type { CullSuggestion } from './autoCull';
import { isEmptyEdit } from './photoEdits';
import type { PhotoFrame } from './types';

/** Background automation must not take over a photo the photographer has started editing. */
export function untouchedForBackgroundAuto(frame: PhotoFrame): boolean {
  return !frame.removedAt && !frame.virtualCopy && !frame.isDemo &&
    !frame.framing && !frame.editHistory?.steps.length &&
    (!frame.edit || isEmptyEdit(frame.edit));
}

/** Only new, untouched, unreviewed frames can receive automatic culling decisions. */
export function backgroundCullCandidates(frames: readonly PhotoFrame[], imported: ReadonlySet<string>): PhotoFrame[] {
  return frames.filter((frame) =>
    imported.has(frame.id) && frame.decision === 'unreviewed' && untouchedForBackgroundAuto(frame));
}

/**
 * The hands-off path only moves clearly safe suggestions.
 * A weak subject classification is never a reason to throw away a photograph.
 * Automated Reject requires the scan's byte-verified exact-duplicate reason.
 */
export function backgroundCullMoves(
  frames: readonly PhotoFrame[], results: readonly CullSuggestion[], imported: ReadonlySet<string>,
): { frameId: string; decision: 'keep' | 'reject' }[] {
  const counts = new Map<string, number>();
  for (const frame of frames) counts.set(frame.id, (counts.get(frame.id) ?? 0) + 1);
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  const seen = new Set<string>();
  return results.flatMap((result) => {
    if (seen.has(result.frameId)) return [];
    seen.add(result.frameId);
    const frame = byId.get(result.frameId);
    if (!frame || counts.get(result.frameId) !== 1 || !imported.has(result.frameId) ||
        frame.decision !== 'unreviewed' || !untouchedForBackgroundAuto(frame) ||
        result.confidence !== 'high' ||
        !Number.isFinite(result.score) || result.score < 0 || result.score > 100) return [];
    if (result.decision === 'keep') return [{ frameId: result.frameId, decision: 'keep' as const }];
    return result.decision === 'reject' && result.reason === 'duplicate'
      ? [{ frameId: result.frameId, decision: 'reject' as const }] : [];
  });
}

/** Develop only untouched keepers. Existing manual edits and crops stay behind the Auto button. */
export function backgroundDevelopTargets(frames: readonly PhotoFrame[], imported: ReadonlySet<string>): Set<string> {
  const counts = new Map<string, number>();
  for (const frame of frames) counts.set(frame.id, (counts.get(frame.id) ?? 0) + 1);
  return new Set(frames.filter((frame) => imported.has(frame.id) && counts.get(frame.id) === 1 &&
    frame.decision === 'keep' && untouchedForBackgroundAuto(frame)).map((frame) => frame.id));
}
