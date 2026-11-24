import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

/**
 * Keyboard behaviour every V2 modal dialog shares: focus moves into the dialog when it opens, Tab and Shift+Tab stay
 * inside it, Escape closes it, and focus goes back to the control that opened it. Escape is the "get me out" key many
 * people rely on under stress, so a dialog that ignores it is a trap (WCAG 2.1.2, 2.4.3).
 */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])', 'summary',
].join(',');

/** Where Tab should go next, wrapping at either end. -1 for "nothing to focus". Pure, so it is unit-tested. */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  if (backwards) return current === 0 ? count - 1 : current - 1;
  return current === count - 1 ? 0 : current + 1;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => !el.closest('[inert]') && el.getClientRects().length > 0);
}

/**
 * Returns a keydown handler for the dialog's outer element. `panelRef` is the visible panel (given tabIndex -1), which
 * takes focus on open so a keyboard user starts inside the dialog without a button being pressed by accident.
 * Keys another part of the dialog has already handled (for example the shortcut recorder) are left alone.
 */
export function useDialogFocus(open: boolean, panelRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [open, panelRef]);

  return useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close.current();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;
    const items = focusables(panelRef.current);
    const index = items.indexOf(document.activeElement as HTMLElement);
    // Only wrap at the ends; in the middle the browser's own order is right.
    const atEdge = index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1);
    if (!atEdge) return;
    const next = nextFocusIndex(items.length, index, event.shiftKey);
    event.preventDefault();
    if (next >= 0) items[next].focus();
  }, [panelRef]);
}
