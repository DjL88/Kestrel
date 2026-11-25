import { recordEdit } from '../../core/editHistory';
import { framingKey, validMasks, type Mask } from '../../core/maskTypes';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import type { CullingState, PhotoFrame } from '../../core/types';
import { readEditGroups, syncEditGroup } from './editGroupState';

/** Include every part of the context in which a verification actually examined pixels. */
export function maskVerificationKey(projectId: string, frame: PhotoFrame): string {
  return JSON.stringify([projectId, frame.id, frame.stableKey, frame.originalSha256,
    frame.removedAt ?? null, framingKey(frame.framing), readEditGroups(frame).activeId,
    frame.editVersions?.activeId, frame.edit?.masks ?? []]);
}

/** Check again against the actual catalogue inside the state update, not only before scheduling it. */
export function commitVerifiedMasks(state: CullingState, projectId: string, source: PhotoFrame, masks: Mask[], at: number): CullingState {
  if (state.shoot.id !== projectId || !validMasks(masks)) return state;
  const frame = state.frames.find(candidate => candidate.id === source.id);
  if (!frame || frame.removedAt != null || maskVerificationKey(projectId, frame) !== maskVerificationKey(projectId, source) ||
      JSON.stringify(frame.edit?.masks ?? []) === JSON.stringify(masks)) return state;
  const updated = syncEditGroup(recordEdit(frame, { edit: { ...(frame.edit ?? DEFAULT_EDIT), masks } }, at));
  return { ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames: state.frames.map(candidate => candidate === frame ? updated : candidate) };
}
