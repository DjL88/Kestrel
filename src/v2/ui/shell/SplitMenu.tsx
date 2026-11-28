import React, { useEffect, useId, useRef, useState } from 'react';
import BrandIcon from '../icons/BrandIcon';
import { STRINGS } from '../strings';

export interface SplitMenuProps {
  /** Splits this frame into the next number of continuous frames. Absent or false-disabled when no more can be added. */
  onSplit?: () => void;
  onDuplicate?: () => void;
  /** Opens the existing Formats panel, where the shape (aspect) and size of a frame are chosen. */
  onResize?: () => void;
}

/**
 * The Split button, opening a small labelled menu (menu button pattern: Enter, Space or Down opens it, arrows move, Home
 * and End jump, Escape closes and returns focus). Every item is a written label; touch targets are 44 px.
 */
export default function SplitMenu({ onSplit, onDuplicate, onResize }: SplitMenuProps) {
  const t = STRINGS.canvas.splitMenu;
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const items = [
    { key: 'split', label: t.split, help: t.splitHelp, run: onSplit, testId: 'split-menu-split' },
    { key: 'duplicate', label: t.duplicate, help: t.duplicateHelp, run: onDuplicate, testId: 'split-menu-duplicate' },
    { key: 'resize', label: t.resize, help: t.resizeHelp, run: onResize, testId: 'split-menu-resize' },
  ];
  const nodes = () => Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
  const focusAt = (index: number) => { const list = nodes(); list[(index + list.length) % list.length]?.focus(); };
  const close = (returnFocus: boolean) => { setOpen(false); if (returnFocus) buttonRef.current?.focus(); };
  useEffect(() => { if (open) focusAt(0); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button ref={buttonRef} type="button" data-testid="split-menu-button" aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? menuId : undefined} title={t.buttonHelp}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); } }}
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-secondary)] shadow-md transition-colors hover:border-[var(--brand-accent)] hover:text-[var(--brand-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
        <BrandIcon name="frame-add" size={18} />
        <span>{t.button}</span>
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={t.label}
          onKeyDown={(event) => {
            const at = nodes().indexOf(document.activeElement as HTMLElement);
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
            else if (event.key === 'ArrowDown') { event.preventDefault(); focusAt(at + 1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); focusAt(at - 1); }
            else if (event.key === 'Home') { event.preventDefault(); focusAt(0); }
            else if (event.key === 'End') { event.preventDefault(); focusAt(-1); }
            else if (event.key === 'Tab') setOpen(false);
          }}
          className="absolute left-0 top-full z-30 mt-1 w-56 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] py-1 text-left text-xs shadow-[var(--shadow-popover)]">
          {items.map((item) => (
            <button key={item.key} type="button" role="menuitem" tabIndex={-1} data-testid={item.testId} title={item.help}
              aria-disabled={!item.run} onClick={() => { if (!item.run) return; close(false); item.run(); }}
              className="flex min-h-11 w-full items-center px-3 text-left text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] focus:bg-[var(--bg-surface-hover)] focus:outline-none focus-visible:underline aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
