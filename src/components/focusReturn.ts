/**
 * Give keyboard focus back when a dialog closes: to the control it came from, or, if that control has gone (a menu item
 * disappears when the menu closes), to the menu button. Never leave it lost on the page, where a keyboard or screen
 * reader user would have to start again from the top.
 */
export function returnFocus(previous: HTMLElement | null): void {
  const shown = (element: Element | null): element is HTMLElement => !!element && element !== document.body && element !== document.documentElement && element.isConnected && (element as HTMLElement).getClientRects().length > 0;
  if (shown(previous)) { previous.focus(); return; }
  [...document.querySelectorAll<HTMLElement>('[data-focus-fallback]')].find(shown)?.focus();
}

/** Remember where focus was when a dialog opens, to hand it back on close. */
export const focusBeforeOpening = (): HTMLElement | null => (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
