import { countOriginalKeepers, limitAutoKeepers, type CullSuggestion } from './autoCull';
import { isEmptyEdit } from './photoEdits';
import type { PhotoFrame } from './types';

/** Background automation must not take over a photo the photographer has started editing. */
export function untouchedForBackgroundAuto(frame: PhotoFrame): boolean {
  return frame.removedAt == null && !frame.virtualCopy && !frame.isDemo &&
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
  return results.flatMap((result): { frameId: string; decision: 'keep' | 'reject' }[] => {
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

/** Finalise a completed import scan against live sources and decisions BEFORE
 * allocating limited keeper slots. An edited/removed/replaced frame or a
 * photo currently being edited must not consume the next eligible slot. */
export function planBackgroundCull(
  frames: readonly PhotoFrame[], examined: readonly PhotoFrame[], results: readonly CullSuggestion[],
  imported: ReadonlySet<string>, target: number, editingFrameId?: string | null,
) {
  const sources = new Map<string, PhotoFrame>();
  const ambiguous = new Set<string>();
  for (const frame of examined) {
    if (sources.has(frame.id)) ambiguous.add(frame.id);
    sources.set(frame.id, frame);
  }
  const live = new Map<string, PhotoFrame>();
  for (const frame of frames) {
    if (live.has(frame.id)) ambiguous.add(frame.id);
    live.set(frame.id, frame);
  }
  const eligible = results.filter(result => {
    const before = sources.get(result.frameId), current = live.get(result.frameId);
    return !!before && !!current && !ambiguous.has(result.frameId) && imported.has(result.frameId) &&
      result.frameId !== editingFrameId && current.decision === 'unreviewed' && untouchedForBackgroundAuto(current) &&
      before.stableKey === current.stableKey && before.originalSha256 === current.originalSha256;
  });
  const limited = limitAutoKeepers(eligible, [...frames], Math.max(0, target - countOriginalKeepers(frames)));
  return { limited, moves: backgroundCullMoves(frames, limited, imported) };
}
