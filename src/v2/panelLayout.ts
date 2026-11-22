/**
 * Pure state for the V2 workspace shell's left-rail tool panels (docs/V2-WORKSPACE.md section 1 and 10,
 * slice 1): which panels exist, whether each is visible, and whether it docks left, docks right, or floats.
 *
 * Only `info` and `tasks` have real content wired in this slice (real EXIF/filename, real task queue).
 * The others are placeholders for later slices (Adjust = recipe editor, Overlays = watermark/text,
 * Formats = size copies, Masks = subject masks, Co-pilot = assistance suggestions) and are rendered as
 * explicitly "not built yet" so nothing here overstates what works (CLAUDE.md: never overstate).
 */

export type PanelId = 'copilot' | 'adjust' | 'formats' | 'masks' | 'overlays' | 'info' | 'tasks';

export type PanelDock = 'left' | 'right' | 'float';

export interface PanelLayoutState {
  visible: boolean;
  dock: PanelDock;
}

export type PanelLayout = Record<PanelId, PanelLayoutState>;

export const PANEL_IDS: readonly PanelId[] = ['copilot', 'adjust', 'formats', 'masks', 'overlays', 'info', 'tasks'];

/** Panels with real, wired content in this slice. Everything else in PANEL_IDS shows a "not built yet" placeholder. */
export const WIRED_PANELS: ReadonlySet<PanelId> = new Set(['info', 'tasks']);

export function defaultPanelLayout(): PanelLayout {
  return {
    copilot: { visible: false, dock: 'left' },
    adjust: { visible: false, dock: 'right' },
    formats: { visible: false, dock: 'right' },
    masks: { visible: false, dock: 'right' },
    overlays: { visible: false, dock: 'right' },
    info: { visible: false, dock: 'right' },
    tasks: { visible: false, dock: 'right' },
  };
}

/** Clicking a rail tool: open it if hidden, close it if already the one open and visible (toggle), never two panels
 * forced open at once from the rail (right-click, handled separately, can still show/hide any panel individually). */
export function toggleRailPanel(layout: PanelLayout, id: PanelId): PanelLayout {
  const wasVisible = layout[id].visible;
  const next: PanelLayout = { ...layout };
  for (const other of PANEL_IDS) {
    if (other !== id) next[other] = { ...next[other], visible: false };
  }
  next[id] = { ...next[id], visible: !wasVisible };
  return next;
}

/** Right-click "Show/Hide" and "Dock/Float" acts on one panel without affecting the others. */
export function setPanelVisible(layout: PanelLayout, id: PanelId, visible: boolean): PanelLayout {
  return { ...layout, [id]: { ...layout[id], visible } };
}

export function setPanelDock(layout: PanelLayout, id: PanelId, dock: PanelDock): PanelLayout {
  return { ...layout, [id]: { ...layout[id], dock } };
}

export function floatPanel(layout: PanelLayout, id: PanelId): PanelLayout {
  return setPanelDock(layout, id, 'float');
}

export function dockPanel(layout: PanelLayout, id: PanelId, side: 'left' | 'right'): PanelLayout {
  return setPanelDock(layout, id, side);
}
