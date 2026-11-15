import { recordEdit } from './editHistory';
import { isEmptyEdit, type PhotoEdit } from './photoEdits';
import type { PhotoFrame } from './types';

/** Count only live selected frames. An already-edited photograph is protected by default. */
export function previewSelectedLook(frames: readonly PhotoFrame[], ids: ReadonlySet<string>, includeEdited = false) {
  const selected = frames.filter((frame) => ids.has(frame.id) && !frame.removedAt);
  const eligible = selected.filter((frame) => includeEdited ||
    (!frame.editHistory?.steps.length && (!frame.edit || isEmptyEdit(frame.edit))));
  return { total: selected.length, eligible: eligible.length, skipped: selected.length - eligible.length };
}

/** Update edit recipes only; retain each destination's masks and framing and preserve undo. */
export function applySelectedLook(
  frames: PhotoFrame[], ids: ReadonlySet<string>, look: PhotoEdit, includeEdited = false, at = Date.now(),
): PhotoFrame[] {
  return frames.map((frame) => {
    if (!ids.has(frame.id) || frame.removedAt ||
        (!includeEdited && (frame.editHistory?.steps.length || (frame.edit && !isEmptyEdit(frame.edit))))) return frame;
    const edit = { ...look, ...(frame.edit?.masks ? { masks: frame.edit.masks } : {}) };
    return recordEdit(frame, { edit }, at);
  });
}
