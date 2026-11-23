import type { CullingState, PhotoFrame } from '../../core/types';
import { recordEdit } from '../../core/editHistory';
import type { OverlaySettings } from '../ui/contract';
import { readOverlay } from './overlayOps';
import { overlayFromTemplate, type OverlayTemplate } from './overlayTemplates';

/** Keep a photo's overlay in the same undoable, persistent history as ordinary edits.
 * No original bytes are read or modified. A no-op must not create a fake history event. */
export function changePhotoOverlay(
  frame: PhotoFrame, change: (overlay: OverlaySettings) => OverlaySettings, at: number,
): PhotoFrame {
  const before = readOverlay(frame.overlay);
  const after = readOverlay(change(before));
  if (JSON.stringify(before) === JSON.stringify(after)) return frame;
  return recordEdit(frame, { overlay: after }, at);
}

/**
 * Apply one template consistently to every selected, live catalogue photo.
 * Each photo gets its own reversible history step, so Undo from that photo
 * restores its previous overlay even after the library is saved and reopened.
 * Does not create fake events for missing IDs, removed photos or identical overlays.
 */
export function applyOverlayTemplateToProject(
  state: CullingState, template: OverlayTemplate, photoIds: readonly string[], at: number,
): { state: CullingState; changed: number } {
  const ids = new Set(photoIds);
  if (!ids.size) return { state, changed: 0 };
  let changed = 0;
  const frames = state.frames.map(frame => {
    if (!ids.has(frame.id) || frame.removedAt !== undefined) return frame;
    const updated = changePhotoOverlay(frame, () => overlayFromTemplate(template), at);
    if (updated !== frame) changed += 1;
    return updated;
  });
  return changed ? {
    state: { ...state, shoot: { ...state.shoot, lastUpdatedAt: at }, frames }, changed,
  } : { state, changed: 0 };
}
