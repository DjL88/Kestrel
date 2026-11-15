import { recordEdit } from './editHistory';
import { isEmptyEdit, type PhotoEdit } from './photoEdits';
import type { PhotoFrame } from './types';

/** A deliberate, reversible batch look. Existing edits are protected unless explicitly included. */
export function previewKeeperLook(frames: PhotoFrame[], includeEdited = false) {
  const keepers = frames.filter((frame) => frame.decision === 'keep' && !frame.removedAt && !frame.virtualCopy);
  const eligible = keepers.filter((frame) =>
    includeEdited || (!frame.editHistory?.steps.length && (!frame.edit || isEmptyEdit(frame.edit))));
  return { total: keepers.length, eligible: eligible.length, skipped: keepers.length - eligible.length };
}

/** Changes the project catalogue only; never modifies an original file or source preview. */
export function applyKeeperLook(frames: PhotoFrame[], look: PhotoEdit, includeEdited = false, at = Date.now()): PhotoFrame[] {
  return frames.map((frame) => {
    if (frame.decision !== 'keep' || frame.removedAt || frame.virtualCopy) return frame;
    if (!includeEdited && (frame.editHistory?.steps.length || (frame.edit && !isEmptyEdit(frame.edit)))) return frame;
    // An existing hand-painted mask is not part of a reusable global look.
    const edit = { ...look, ...(frame.edit?.masks ? { masks: frame.edit.masks } : {}) };
    return recordEdit(frame, { edit }, at);
  });
}
