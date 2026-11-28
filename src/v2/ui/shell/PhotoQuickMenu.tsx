import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DecisionState } from '../contract';
import { STRINGS } from '../strings';

export interface PhotoQuickMenuProps {
  /** Where the menu opens (the press, or the middle of the focused tile for the keyboard). */
  x: number;
  y: number;
  /** The photo the menu is about and what it is now, so the words say what a press will do. */
  photoName: string;
  decision: DecisionState;
  rating: number;
  /** How many photos the actions apply to (the whole selection when the photo is part of it). */
  count: number;
  onOpen?: () => void;
  onToggleFlag: () => void;
  onSetDecision: (decision: DecisionState) => void;
  onSetRating: (rating: number) => void;
  /** Auto for this one photo, when the editor offers it. */
  onAuto?: () => void;
  onClose: () => void;
}

/**
 * The gallery's photo menu: right-click, the Menu key or Shift+F10 on a focused tile, or a long press on touch. The same
 * real actions as the filmstrip's menu, with every target at least 44 px so a finger can hit it. Keyboard: Up and Down
 * move, Home and End jump, Escape closes and puts focus back on the tile.
 */
export default function PhotoQuickMenu(props: PhotoQuickMenuProps) {
  const { x, y, photoName, decision, rating, count, onOpen, onToggleFlag, onSetDecision, onSetRating, onAuto, onClose } = props;
  const t = STRINGS.pairCompare;
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const [place, setPlace] = useState({ left: x, top: y });
  const many = count > 1;

  // Keep the whole menu on screen, whatever the screen's size.
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    setPlace({ left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) });
  }, [x, y]);

  const enabled = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  useEffect(() => {
    enabled()[0]?.focus({ preventScroll: true });
    const keep = previous.current;
    // Only a new press outside the menu closes it: the compatibility events that follow a held touch's release do not.
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onClose(); };
    const away = () => onClose();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', away);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', away);
      window.removeEventListener('resize', away);
      if (keep && document.contains(keep)) keep.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Menu keys belong to the menu, even when they are bound to a culling shortcut.
    event.stopPropagation();
    const all = enabled();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => { event.preventDefault(); all[(to + all.length) % all.length]?.focus(); };
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    else if (event.key === 'ArrowDown') move(at + 1);
    else if (event.key === 'ArrowUp') move(at - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(all.length - 1);
    else if (event.key === 'Tab') { event.preventDefault(); onClose(); }
  };

  const choose = (run: () => void) => () => { run(); onClose(); };
  const item = 'flex min-h-11 w-full items-center px-3 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] focus-visible:bg-[var(--bg-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)] disabled:opacity-40';

  return (
    <div ref={root} role="menu" aria-label={`${STRINGS.filmstripLabels.label7}: ${photoName}`} data-testid="photo-quick-menu"
      onKeyDown={onKeyDown} onContextMenu={(event) => event.preventDefault()}
      style={{ left: place.left, top: place.top, maxHeight: 'calc(100dvh - 16px)' }}
      className="fixed z-[80] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] py-1.5 shadow-[var(--shadow-popover)]">
      {onOpen && !many && <button type="button" role="menuitem" onClick={choose(onOpen)} className={item}>{t.edit}</button>}
      {onAuto && !many && <button type="button" role="menuitem" onClick={choose(onAuto)} className={item}>{STRINGS.autoEdit.label}</button>}
      <button type="button" role="menuitem" onClick={choose(onToggleFlag)} className={item}>{decision === 'keep' ? t.unflag : t.flag}</button>
      {decision !== 'reject' && <button type="button" role="menuitem" onClick={choose(() => onSetDecision('reject'))} className={item}>{t.setAside}</button>}
      {decision !== 'unreviewed' && <button type="button" role="menuitem" onClick={choose(() => onSetDecision('unreviewed'))} className={item}>{t.putBack}</button>}
      <div role="group" aria-label={STRINGS.filmstripLabels.label8} className="mt-1 border-t border-[var(--border-subtle)] px-2 pt-1.5">
        <span className="mb-1 block px-1 text-[0.6875rem] text-[var(--text-secondary)]">{STRINGS.filmstripLabels.label13}</span>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="menuitemradio" aria-label={t.rate(n)} title={t.rate(n)} aria-checked={!many && n === rating}
              // Choosing the rating a photo already has clears it, as the stars on the tile do.
              onClick={choose(() => onSetRating(!many && n === rating ? 0 : n))}
              className="grid min-h-11 min-w-11 flex-1 place-items-center rounded border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
