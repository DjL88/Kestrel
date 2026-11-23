import { recordEdit } from '../../core/editHistory';
import { framingKey, type Mask } from '../../core/maskTypes';
import { DEFAULT_EDIT } from '../../core/photoEdits';
import type { CullingState, PhotoFrame } from '../../core/types';
import { readEditGroups, syncEditGroup } from './editGroupState';
import { canAddMask } from './maskOps';

/** A model result is valid only in the photo and edit context it examined. */
export function subjectMaskTarget(state: CullingState, projectId: string, source: PhotoFrame): PhotoFrame | undefined {
  if (state.shoot.id !== projectId) return undefined;
  const frame = state.frames.find(candidate => candidate.id === source.id);
  if (!frame || frame.removedAt != null || frame.stableKey !== source.stableKey ||
      frame.originalSha256 !== source.originalSha256 || framingKey(frame.framing) !== framingKey(source.framing) ||
      readEditGroups(frame).activeId !== readEditGroups(source).activeId ||
      frame.editVersions?.activeId !== source.editVersions?.activeId ||
      !canAddMask(frame.edit?.masks)) return undefined;
  return frame;
}

export function commitSubjectMask(
  state: CullingState, projectId: string, source: PhotoFrame, mask: Extract<Mask, { kind: 'subject' }>, at: number,
): CullingState {
  const frame = subjectMaskTarget(state, projectId, source);
  if (!frame || mask.framingKey !== framingKey(frame.framing)) return state;
  const edit = { ...(frame.edit ?? DEFAULT_EDIT), masks: [...(frame.edit?.masks ?? []), mask] };
  const updated = syncEditGroup(recordEdit(frame, { edit }, at));
  return {
    ...state,
    shoot: { ...state.shoot, lastUpdatedAt: at },
    frames: state.frames.map(candidate => candidate === frame ? updated : candidate),
  };
}
