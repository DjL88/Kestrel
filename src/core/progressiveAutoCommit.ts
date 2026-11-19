import { recordEdit } from './editHistory';
import { isEmptyEdit, type PhotoEdit } from './photoEdits';
import { untouchedForBackgroundAuto } from './backgroundAutoPolicy';
import type { CullingState } from './types';

/** Each result is scoped to the project and photo that actually produced it. */
export interface CompletedAutoResult {
  projectId: string;
  frameId: string;
  edit: PhotoEdit;
  at: number;
  /** The photo currently being edited by hand, if any. It must always win. */
  editingFrameId?: string;
}

/**
 * Commit ONE completed, quality-gated Auto recipe, without waiting for the rest of
 * a 500-photo shoot. This is intentionally a pure, defensive state transition:
 * asynchronous results must never overwrite a manual edit, changed decision,
 * removed image, duplicate catalogue identity, or a different open project.
 */
export function commitCompletedAutoResult(state: CullingState, update: CompletedAutoResult): CullingState {
  if (!state.settings?.autoEdit || state.shoot.id !== update.projectId ||
      !update.frameId || update.frameId === update.editingFrameId ||
      !Number.isFinite(update.at) || isEmptyEdit(update.edit)) return state;

  const matching = state.frames.filter((frame) => frame.id === update.frameId);
  if (matching.length !== 1) return state;
  const frame = matching[0];
  if (frame.decision !== 'keep' || !untouchedForBackgroundAuto(frame)) return state;

  const revised = recordEdit(frame, { edit: update.edit }, update.at);
  if (revised === frame) return state;
  return {
    ...state,
    frames: state.frames.map((entry) => entry === frame ? revised : entry),
    shoot: { ...state.shoot, lastUpdatedAt: Math.max(state.shoot.lastUpdatedAt, update.at) },
  };
}
