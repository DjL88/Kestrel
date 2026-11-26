import type { CommandId } from './registry';
import type { SettingsTabId } from '../contract';

/**
 * What a native desktop menu id (from src-tauri/src/lib.rs, sent as the "menu" event) means in V2.
 * Unknown ids map to null and do nothing. When each item is available is decided in menuState.ts.
 * Several accelerators (Cmd+E, Cmd+A, Cmd+O, and Ctrl+M on Windows) are taken by the native menu before the page sees the key, so without this
 * bridge those keys would do nothing at all in the desktop app.
 */
export type MenuAction =
  | { kind: 'command'; id: CommandId }
  | { kind: 'rate'; rating: number }
  | { kind: 'decision'; value: 'keep' | 'unreviewed' }
  | { kind: 'import' }
  | { kind: 'deselectAll' }
  | { kind: 'toggleFilmstrip' }
  | { kind: 'settings'; tab: SettingsTabId }
  | { kind: 'removedPhotos' }
  | { kind: 'saveXmp' }
  | { kind: 'backupNow' }
  | { kind: 'quickExport' }
  | { kind: 'backupFile' }
  | { kind: 'readXmp' }
  | { kind: 'readLightroom' }
  | { kind: 'openExport' }
  | { kind: 'resetPhoto' }
  | { kind: 'backToProjects' }
  | { kind: 'fullscreen' };

const TABLE: Record<string, MenuAction> = {
  export: { kind: 'command', id: 'file.export' },
  add: { kind: 'import' },
  'photos-select-all': { kind: 'command', id: 'edit.selectAll' },
  'photos-deselect-all': { kind: 'deselectAll' },
  'edit-copy-adjustments': { kind: 'command', id: 'edit.copy' },
  'edit-paste-adjustments': { kind: 'command', id: 'edit.paste' },
  'photo-keep': { kind: 'decision', value: 'keep' },
  // Photo > Set aside: the same as the X key, so it also moves on when "advance after a decision" is on.
  'photo-reject': { kind: 'command', id: 'photo.reject' },
  'photo-unreview': { kind: 'decision', value: 'unreviewed' },
  'photo-undo': { kind: 'command', id: 'edit.undo' },
  'photo-redo': { kind: 'command', id: 'edit.redo' },
  'photo-compare': { kind: 'command', id: 'view.compare' },
  'view-grid': { kind: 'command', id: 'view.grid' },
  // View > Single photo did nothing in V2; it closes the grid, as E does.
  'view-loupe': { kind: 'command', id: 'view.loupe' },
  'view-compare': { kind: 'command', id: 'view.compare' },
  filmstrip: { kind: 'toggleFilmstrip' },
  appearance: { kind: 'settings', tab: 'appearance' },
  'settings-ai': { kind: 'settings', tab: 'aiProviders' },
  'settings-storage': { kind: 'settings', tab: 'storage' },
  'macro-pad': { kind: 'settings', tab: 'keyboard' },
  // V2-only File items (src-tauri/src/lib.rs). The header menus are hidden in the desktop app, so these are the way in.
  'removed-photos': { kind: 'removedPhotos' },
  'xmp-save': { kind: 'saveXmp' },
  'backup-now': { kind: 'backupNow' },
  'export-again': { kind: 'quickExport' },
  'backup-file': { kind: 'backupFile' },
  'xmp-read': { kind: 'readXmp' },
  'lightroom-read': { kind: 'readLightroom' },
  'open-export': { kind: 'openExport' },
  'reset-photo': { kind: 'resetPhoto' },
  'back-to-projects': { kind: 'backToProjects' },
  // macOS InFlight > Settings… (Cmd+,), Help menu, and Full screen on Windows and Linux.
  'settings-open': { kind: 'settings', tab: 'appearance' },
  'help-build': { kind: 'settings', tab: 'privacy' },
  'help-shortcuts': { kind: 'command', id: 'help.toggle' },
  'view-fullscreen': { kind: 'fullscreen' },
  ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((rating) => [`photo-rate-${rating}`, { kind: 'rate', rating } as MenuAction])),
};

export function menuActionForV2(id: string): MenuAction | null {
  return Object.prototype.hasOwnProperty.call(TABLE, id) ? TABLE[id] : null;
}

/** Edit > Select All while a text field has focus must select that field's text, not the photos. */
export function selectAllBelongsToField(active: Element | null): boolean {
  if (!active) return false;
  const tag = active.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || (active instanceof HTMLElement && active.isContentEditable);
}