import { recordEdit, type EditWhy } from '../../core/editHistory';
import { readEditGroups, syncEditGroup } from './editGroupState';
import type { PhotoEdit } from '../../core/photoEdits';
import type { CullingState, PhotoFrame } from '../../core/types';
import { v2Text } from '../../i18n/areas/v2';

/**
 * Compare against the catalogue at write time, after any intervening manual edits. Normally the photo must still be the
 * one on the canvas; the background batch after an import (`anyPhoto`) works on photos that are not open.
 */
export function commitAutoEdit(
  state: CullingState,
  projectId: string,
  examined: PhotoFrame,
  proposal: PhotoEdit,
  at: number,
  why?: EditWhy,
  options: { anyPhoto?: boolean } = {},
): CullingState {
  if (state.shoot.id !== projectId || examined.edit || examined.editHistory?.steps.length) return state;
  const frameId = options.anyPhoto ? examined.id : state.selectedFrameId ?? state.frames.find((frame) => frame.removedAt == null)?.id;
  if (frameId !== examined.id) return state;

  const index = state.frames.findIndex((frame) => frame.id === frameId);
  const frame = state.frames[index];
  if (!frame || frame.removedAt != null || frame.edit || frame.editHistory !== examined.editHistory ||
      frame.framing !== examined.framing || frame.stableKey !== examined.stableKey ||
      frame.originalSha256 !== examined.originalSha256 ||
      readEditGroups(frame).activeId !== readEditGroups(examined).activeId ||
      frame.editVersions?.activeId !== examined.editVersions?.activeId) return state;

  const frames = state.frames.slice();
  frames[index] = syncEditGroup(recordEdit(frame, { edit: proposal }, at, why));
  return { ...state, frames, shoot: { ...state.shoot, lastUpdatedAt: at } };
}

/** Shown when the vision guardian held an Auto-pilot edit back, in the person's language. The edit stays available as a Co-pilot suggestion. */
export const autopilotHeldForReview = (): string => v2Text.guardian.autopilotHeld;

/**
 * Auto-pilot never applies an edit on its own to a photo whose file says it was already edited in another app: that
 * look is the photographer's. A press of Auto still asks for one, and Co-pilot still shows the suggestion. Only the
 * file's metadata decides this, never a vision model's guess.
 */
export function autopilotSkipsEditedElsewhere(frame: Pick<PhotoFrame, 'exif'>): boolean {
  return frame.exif?.editStatus?.kind === 'edited-elsewhere';
}

/** Shown once when Auto-pilot left a photo alone because it was already edited elsewhere. */
export const autopilotSkippedEdited = (): string => v2Text.guardian.autopilotSkippedEdited;
