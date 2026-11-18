import { useEffect } from 'react';
import { isDesktopApp } from './desktopShell';

/** Button text each native menu item presses. A first version: it reuses the buttons already on screen. */
const BUTTONS: Record<string, RegExp> = { export: /^export$/i, 'macro-pad': /^macro pad$/i, filmstrip: /^(show|hide) filmstrip$/i };

export function useDesktopMenu() {
  useEffect(() => {
    if (!isDesktopApp()) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('@tauri-apps/api/event').then(({ listen }) => listen<string>('menu', ({ payload }) => {
      if (payload === 'photos-select-all' || payload === 'photos-deselect-all') {
        // Dispatch a real photo command. Never select arbitrary page text/DOM elements.
        // In a focused text field, Cmd/Ctrl+A must still select that field's text.
        const focus = document.activeElement;
        if (payload === 'photos-select-all' && (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement)) {
          focus.select();
          return;
        }
        if (payload === 'photos-select-all' && focus instanceof HTMLElement && focus.isContentEditable) {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(focus);
          selection?.removeAllRanges();
          selection?.addRange(range);
          return;
        }
        window.dispatchEvent(new Event('kestrel:' + payload));
        return;
      }
      if (payload === 'macro-pad') {
        window.dispatchEvent(new Event('kestrel:open-macro-pad'));
        return;
      }
      if (payload === 'appearance') {
        const gear = document.querySelector<HTMLButtonElement>('button[aria-label="Appearance and layout settings"]');
        if (gear) gear.click();
        else document.querySelector<HTMLButtonElement>('button[aria-label="Workspace options"]')?.click();
        return;
      }
      const pattern = BUTTONS[payload];
      const button = pattern && [...document.querySelectorAll('button')].find((item) => pattern.test(item.textContent?.trim() ?? ''));
      button?.click();
    })).then((unlisten) => { if (cancelled) unlisten(); else stop = unlisten; });
    return () => { cancelled = true; stop?.(); };
  }, []);
}
