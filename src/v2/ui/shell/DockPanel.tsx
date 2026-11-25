import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DockPosition, PanelId } from '../contract';
import BrandIcon from '../icons/BrandIcon';
import { STRINGS } from '../strings';

interface DockPanelProps {
  panelId: PanelId;
  title: string;
  dock: DockPosition;
  floatX: number;
  floatY: number;
  onSetDock: (dock: DockPosition) => void;
  onMoveFloat: (x: number, y: number) => void;
  onClose: () => void;
  children: React.ReactNode;
}

const PLACES: { dock: DockPosition; icon: 'arrow-left-to-line' | 'arrow-right-to-line' | 'float'; text: () => string }[] = [
  { dock: 'left', icon: 'arrow-left-to-line', text: () => STRINGS.rail.dockLeft },
  { dock: 'right', icon: 'arrow-right-to-line', text: () => STRINGS.rail.dockRight },
  { dock: 'float', icon: 'float', text: () => STRINGS.rail.floatPanel },
];

export default function DockPanel({
  panelId,
  title,
  dock,
  floatX,
  floatY,
  onSetDock,
  onMoveFloat,
  onClose,
  children,
}: DockPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [menuOpen]);
  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); menuButtonRef.current?.focus(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); items[(at + 1) % items.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
    else if (event.key === 'Tab') setMenuOpen(false);
  };
  const dragOrigin = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dock !== 'float') return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOrigin.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: floatX,
      origY: floatY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOrigin.current || dock !== 'float') return;
    const dx = e.clientX - dragOrigin.current.startX;
    const dy = e.clientY - dragOrigin.current.startY;
    const nextX = Math.max(12, Math.min(window.innerWidth - 332, dragOrigin.current.origX + dx));
    const nextY = Math.max(58, Math.min(window.innerHeight - 160, dragOrigin.current.origY + dy));
    onMoveFloat(nextX, nextY);
  };

  const handlePointerUp = () => {
    dragOrigin.current = null;
  };

  const isFloat = dock === 'float';

  const pane = (
    <section
      aria-label={STRINGS.shellLabels.panelLabel(title)}
      data-panel-id={panelId}
      data-dock={dock}
      className={
        isFloat
          ? 'fixed z-30 flex max-h-[76vh] w-[320px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]'
          : `hidden md:flex h-full w-[var(--dock-width)] shrink-0 flex-col overflow-hidden bg-[var(--bg-surface)] ${
              dock === 'left'
                ? 'border-r border-[var(--border-subtle)]'
                : 'border-l border-[var(--border-subtle)]'
            }`
      }
      style={isFloat ? { left: floatX, top: floatY } : undefined}
    >
      {/* Panel header with drag handle & dock controls */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={`flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3.5 ${
          isFloat ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isFloat && (
            <BrandIcon name="grip" size={14} className="text-[var(--text-muted)]" />
          )}
          <h2 className="truncate text-xs font-semibold tracking-wide text-[var(--text-primary)]">
            {title}
          </h2>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <div className="relative">
            {/* Dock left / right / float sit behind one "…" button, so the arrows are never mistaken for Undo and Redo. */}
            <button
              ref={menuButtonRef}
              type="button"
              title={STRINGS.shellLabels.panelPlaceLabel(title)}
              aria-label={STRINGS.shellLabels.panelPlaceLabel(title)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-testid="dock-panel-menu"
              onClick={() => setMenuOpen((open) => !open)}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-xs)] transition-colors ${
                menuOpen
                  ? 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <BrandIcon name="more" size={16} />
            </button>
            {menuOpen && (
              <div
                ref={menuRef}
                role="menu"
                aria-label={STRINGS.shellLabels.panelPlaceLabel(title)}
                data-testid="dock-panel-menu-list"
                onKeyDown={onMenuKeyDown}
                className="absolute right-0 top-full z-40 mt-1 w-44 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] py-1 shadow-[var(--shadow-popover)]"
              >
                {PLACES.map((place) => (
                  <button
                    key={place.dock}
                    type="button"
                    role="menuitemradio"
                    aria-checked={dock === place.dock}
                    data-testid={`dock-panel-${place.dock}`}
                    onClick={() => { setMenuOpen(false); menuButtonRef.current?.focus(); if (dock !== place.dock) onSetDock(place.dock); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] focus-visible:bg-[var(--bg-surface-hover)] focus-visible:outline-none"
                  >
                    <BrandIcon name={place.icon} size={14} className="text-[var(--text-muted)]" />
                    <span className="flex-1">{place.text()}</span>
                    {/* The current place is ticked, not only tinted. */}
                    {dock === place.dock && <BrandIcon name="check" size={12} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label={`Close ${title} panel`}
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-xs)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <BrandIcon name="close" size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto inflight-scroll p-4">{children}</div>
    </section>
  );

  // A floating panel must sit outside the clipped flex workspace. Keep it
  // inside the V2 root so inherited theme variables and keyboard events work.
  // Docked panels remain in normal layout and reserve their original space.
  const portalHost = isFloat && typeof document !== 'undefined'
    ? document.querySelector('.inflight-v2')
    : null;
  return portalHost ? createPortal(pane, portalHost) : pane;
}
