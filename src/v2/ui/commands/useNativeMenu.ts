import { useEffect, useRef } from 'react';
import { isDesktopApp } from '../../../providers/desktopShell';
import { menuActionForV2, selectAllBelongsToField, type MenuAction } from './menuMap';
import { menuStateChanges, type MenuState } from './menuState';

/** Runs V2's version of a native desktop menu choice. Does nothing in a browser tab. */
export function useNativeMenu(run: (action: MenuAction) => void): void {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!isDesktopApp()) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('@tauri-apps/api/event').then(({ listen }) => listen<string>('menu', ({ payload }) => {
      const action = menuActionForV2(payload);
      if (!action) return;
      // Cmd/Ctrl+A in a text field selects the field's text.
      if (action.kind === 'command' && action.id === 'edit.selectAll' && selectAllBelongsToField(document.activeElement)) {
        const focus = document.activeElement;
        if (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement) focus.select();
        return;
      }
      latest.current(action);
    })).then((unlisten) => { if (cancelled) unlisten(); else stop = unlisten; });
    return () => { cancelled = true; stop?.(); };
  }, []);
}
/**
 * Keeps the native menu's greyed-out items in step with the app. Only the items that changed are sent, so a render that
 * changes nothing (most of them) sends nothing. Does nothing in a browser tab.
 */
export function useNativeMenuState(state: MenuState): void {
  const shown = useRef<MenuState | null>(null);
  const key = JSON.stringify(state);
  useEffect(() => {
    if (!isDesktopApp()) return;
    const next = JSON.parse(key) as MenuState;
    const items = menuStateChanges(shown.current, next);
    if (items.length === 0) return;
    shown.current = next;
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke('menu_set_enabled', { items })).catch(() => {
      // An older desktop build without the command: leave every item available, as before.
    });
  }, [key]);
}
