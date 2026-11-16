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
