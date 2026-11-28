import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog's keyboard rules in one place: focus moves in when it opens (to `initial`, else the first control),
 * Tab and Shift+Tab stay inside, Escape closes, and focus goes back to what opened it. Registered in the capture phase
 * so Escape never also reaches a handler behind the dialog.
 */
export function useFocusTrap(open: boolean, dialog: RefObject<HTMLElement | null>, onClose: () => void, initial?: RefObject<HTMLElement | null>) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (initial?.current ?? controls()[0])?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return; }
      if (event.key !== 'Tab') return;
      const items = controls();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0]; const last = items[items.length - 1];
      const active = document.activeElement;
      if (!dialog.current?.contains(active)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); previous?.focus(); };
    // The dialog's contents change while it is open; only opening and closing re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
