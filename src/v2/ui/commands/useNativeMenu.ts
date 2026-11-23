import { useEffect, useRef } from 'react';
import { isDesktopApp } from '../../../providers/desktopShell';
import { menuActionForV2, selectAllBelongsToField, type MenuAction } from './menuMap';

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