import type { CommandId } from './registry';
import type { SettingsTabId } from '../contract';

/**
 * What a native desktop menu id (from src-tauri/src/lib.rs, sent as the "menu" event) means in V2.
 * The native menu is shared with the current app, so ids V2 has no use for (editor tabs, bursts, Auto tab...) map to null and do nothing.
 * Several accelerators (Cmd+E, Cmd+A, Cmd+O, Cmd+M) are taken by the native menu before the page sees the key, so without this
 * bridge those keys would do nothing at all in the desktop app.
 */
export type MenuAction =
  | { kind: 'command'; id: CommandId }
  | { kind: 'rate'; rating: number }
  | { kind: 'decision'; value: 'keep' | 'unreviewed' }
  | { kind: 'import' }
  | { kind: 'deselectAll' }
  | { kind: 'toggleFilmstrip' }
  | { kind: 'settings'; tab: SettingsTabId };

const TABLE: Record<string, MenuAction> = {
  export: { kind: 'command', id: 'file.export' },
  add: { kind: 'import' },
  'photos-select-all': { kind: 'command', id: 'edit.selectAll' },
  'photos-deselect-all': { kind: 'deselectAll' },
  'edit-copy-adjustments': { kind: 'command', id: 'edit.copy' },
  'edit-paste-adjustments': { kind: 'command', id: 'edit.paste' },
  'photo-keep': { kind: 'decision', value: 'keep' },
  'photo-unreview': { kind: 'decision', value: 'unreviewed' },
  'photo-undo': { kind: 'command', id: 'edit.undo' },
  'photo-redo': { kind: 'command', id: 'edit.redo' },
  'photo-compare': { kind: 'command', id: 'view.compare' },
  'view-grid': { kind: 'command', id: 'view.grid' },
  'view-compare': { kind: 'command', id: 'view.compare' },
  filmstrip: { kind: 'toggleFilmstrip' },
  appearance: { kind: 'settings', tab: 'appearance' },
  'settings-ai': { kind: 'settings', tab: 'aiProviders' },
  'settings-storage': { kind: 'settings', tab: 'storage' },
  'macro-pad': { kind: 'settings', tab: 'keyboard' },
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