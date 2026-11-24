/**
 * Where an undocked floating control (the canvas zoom bar) sits inside its area.
 * The offset is measured from the area's bottom-right corner, so the docked place is { right: 0, bottom: 0 }
 * and the control keeps its place when the window grows or the side panels open and close.
 */
export interface DockOffset { right: number; bottom: number }

export const DOCKED: DockOffset = { right: 0, bottom: 0 };
/** Closer than this to the docked corner, a dropped control snaps home (it is docked again). */
export const DOCK_SNAP_PX = 24;
/** One arrow-key nudge. */
export const DOCK_NUDGE_PX = 16;

/** Keeps the whole control inside the area: it can never be dragged out of sight. */
export function clampDockOffset(offset: DockOffset, area: { width: number; height: number }, control: { width: number; height: number }, margin = 12): DockOffset {
  const maxRight = Math.max(0, area.width - control.width - margin * 2);
  const maxBottom = Math.max(0, area.height - control.height - margin * 2);
  const clamp = (value: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(0, Math.round(value))) : 0;
  return { right: clamp(offset.right, maxRight), bottom: clamp(offset.bottom, maxBottom) };
}

/** Within the snap distance of the corner, the control returns to its docked place. */
export function snapDockOffset(offset: DockOffset): DockOffset {
  return Math.hypot(offset.right, offset.bottom) <= DOCK_SNAP_PX ? DOCKED : offset;
}

export function isDocked(offset: DockOffset): boolean {
  return offset.right === 0 && offset.bottom === 0;
}

/** Arrow keys move the control by one nudge; Home docks it. Other keys leave it where it is (null). */
export function nudgeDockOffset(offset: DockOffset, key: string): DockOffset | null {
  switch (key) {
    case 'ArrowLeft': return { ...offset, right: offset.right + DOCK_NUDGE_PX };
    case 'ArrowRight': return { ...offset, right: offset.right - DOCK_NUDGE_PX };
    case 'ArrowUp': return { ...offset, bottom: offset.bottom + DOCK_NUDGE_PX };
    case 'ArrowDown': return { ...offset, bottom: offset.bottom - DOCK_NUDGE_PX };
    case 'Home': return DOCKED;
    default: return null;
  }
}

/** Reads a saved offset, rejecting anything that is not two finite, non-negative numbers. */
export function parseDockOffset(raw: string | null): DockOffset {
  if (!raw) return DOCKED;
  try {
    const value = JSON.parse(raw) as Partial<DockOffset>;
    if (typeof value?.right === 'number' && typeof value?.bottom === 'number' && Number.isFinite(value.right) && Number.isFinite(value.bottom) && value.right >= 0 && value.bottom >= 0) {
      return { right: value.right, bottom: value.bottom };
    }
  } catch { /* a damaged value falls back to docked */ }
  return DOCKED;
}
