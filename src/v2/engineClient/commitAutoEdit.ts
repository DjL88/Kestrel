import { recordEdit } from '../../core/editHistory';
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
      frame.originalSha256 !== examined.originalSha256) return state;

  const frames = state.frames.slice();
  frames[index] = recordEdit(frame, { edit: proposal }, at);
  return { ...state, frames, shoot: { ...state.shoot, lastUpdatedAt: at } };
}
