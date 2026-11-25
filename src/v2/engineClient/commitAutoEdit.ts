import { recordEdit } from '../../core/editHistory';
import { readEditGroups, syncEditGroup } from './editGroupState';
import type { PhotoEdit } from '../../core/photoEdits';
import type { CullingState, PhotoFrame } from '../../core/types';

/** Compare against the catalogue at write time, after any intervening manual edits. */
export function commitAutoEdit(
  state: CullingState,
  projectId: string,
  examined: PhotoFrame,
  proposal: PhotoEdit,
  at: number,
): CullingState {
  if (state.shoot.id !== projectId || examined.edit || examined.editHistory?.steps.length) return state;
  const frameId = state.selectedFrameId ?? state.frames.find((frame) => frame.removedAt == null)?.id;
  if (frameId !== examined.id) return state;

  const index = state.frames.findIndex((frame) => frame.id === frameId);
  const frame = state.frames[index];
  if (!frame || frame.removedAt != null || frame.edit || frame.editHistory !== examined.editHistory ||
      frame.framing !== examined.framing || frame.stableKey !== examined.stableKey ||
      frame.originalSha256 !== examined.originalSha256 ||
      readEditGroups(frame).activeId !== readEditGroups(examined).activeId ||
      frame.editVersions?.activeId !== examined.editVersions?.activeId) return state;

  const frames = state.frames.slice();
  frames[index] = syncEditGroup(recordEdit(frame, { edit: proposal }, at));
  return { ...state, frames, shoot: { ...state.shoot, lastUpdatedAt: at } };
}

/** Shown when the vision guardian held an Auto-pilot edit back. The edit stays available as a Co-pilot suggestion. */
export const AUTOPILOT_HELD_FOR_REVIEW = 'Auto-pilot held this edit for your review: the on-device vision check was not convinced it looks natural. The suggestion is in Co-pilot to preview or apply. Nothing was changed.';
