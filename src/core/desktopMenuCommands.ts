import type { AliasAction } from './shortcutAliases';
import type { WorkspaceViewMode } from './types';

/**
 * What the desktop app's native Photo and View menu items do. The native menu (src-tauri/src/lib.rs) only sends an id;
 * this one table says what each id means, so the menu, the keys and the right-click menu share the same actions.
 * Plain-letter keys are deliberately not menu accelerators: a native accelerator would fire while typing in a field.
 */
export type MenuAction =
  | AliasAction
  | { kind: 'view'; mode: WorkspaceViewMode }
  | { kind: 'photoOnly' };

const RATINGS = [0, 1, 2, 3, 4, 5] as const;

const TABLE: Record<string, MenuAction> = {
  'photo-keep': { kind: 'command', id: 'cull.keep' },
  'photo-reject': { kind: 'command', id: 'cull.reject' },
  'photo-unreview': { kind: 'command', id: 'cull.unreviewed' },
  'photo-undo': { kind: 'command', id: 'cull.undo' },
  'photo-redo': { kind: 'command', id: 'cull.redo' },
  'photo-compare': { kind: 'command', id: 'cull.compare' },
  'view-grid': { kind: 'view', mode: 'grid' },
  'view-loupe': { kind: 'view', mode: 'loupe' },
  'view-compare': { kind: 'view', mode: 'compare' },
  'view-photo-only': { kind: 'photoOnly' },
  ...Object.fromEntries(RATINGS.map((rating) => [`photo-rate-${rating}`, { kind: 'rate', rating } as MenuAction])),
};

/** Every native menu id this module handles. */
export const DESKTOP_MENU_ACTION_IDS: readonly string[] = Object.keys(TABLE);

export function menuActionFor(id: string): MenuAction | null {
  return Object.prototype.hasOwnProperty.call(TABLE, id) ? TABLE[id] : null;
}
