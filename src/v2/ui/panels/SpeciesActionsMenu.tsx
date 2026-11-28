import React, { useEffect, useId, useRef, useState } from 'react';
import { STRINGS } from '../strings';

interface SpeciesActionsMenuProps {
  onEditManually: () => void;
  /** Only for a name InFlight found by itself; absent when the person chose the name. */
  onDetectSubject?: () => void;
}

/**
 * The subject row's actions behind one "…" button (menu button pattern): Enter, Space or Down opens it, arrow keys
 * move, Home and End jump, Enter picks, Escape closes and returns focus to the button. A written label, not an icon alone.
 */
export default function SpeciesActionsMenu({ onEditManually, onDetectSubject }: SpeciesActionsMenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const items = [
    { key: 'edit', label: STRINGS.panelWords.editManually, help: undefined as string | undefined, run: onEditManually, testId: 'species-edit-manually' },
    ...(onDetectSubject ? [{ key: 'detect', label: STRINGS.panelWords.detectSubject, help: STRINGS.panelWords.detectSubjectHelp, run: onDetectSubject, testId: 'species-look-again' }] : []),
  ];

  const focusItem = (index: number) => {
    const nodes = rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    nodes?.[(index + items.length) % items.length]?.focus();
  };
  const close = (returnFocus: boolean) => { setOpen(false); if (returnFocus) buttonRef.current?.focus(); };

  useEffect(() => { if (open) focusItem(0); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  return (
    <span ref={rootRef} className="relative shrink-0">
      <button ref={buttonRef} type="button" data-testid="species-actions"
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        aria-label={STRINGS.panelWords.subjectActions} title={STRINGS.panelWords.subjectActions}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); } }}
        className="flex h-7 w-7 items-center justify-center rounded border border-[var(--border-subtle)] text-sm leading-none text-[var(--text-primary)]">
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={STRINGS.panelWords.subjectActions}
          onKeyDown={(event) => {
            const at = items.findIndex((_, index) => rootRef.current?.querySelectorAll('[role="menuitem"]')[index] === document.activeElement);
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
            else if (event.key === 'ArrowDown') { event.preventDefault(); focusItem(at + 1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); focusItem(at - 1); }
            else if (event.key === 'Home') { event.preventDefault(); focusItem(0); }
            else if (event.key === 'End') { event.preventDefault(); focusItem(items.length - 1); }
            else if (event.key === 'Tab') setOpen(false);
          }}
          className="absolute right-0 z-20 mt-1 min-w-40 rounded border border-[var(--border-default)] bg-[var(--bg-elevated,var(--bg-input))] py-1 text-left text-xs shadow-lg">
          {items.map((item) => (
            <button key={item.key} type="button" role="menuitem" tabIndex={-1} data-testid={item.testId} title={item.help}
              onClick={() => { close(item.key === 'edit' ? false : true); item.run(); }}
              className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover,var(--border-subtle))] focus:bg-[var(--bg-hover,var(--border-subtle))] focus:underline focus:outline-none">
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
