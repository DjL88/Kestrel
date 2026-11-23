import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import type { DockPosition, PanelId } from '../contract';
import BrandIcon from '../icons/BrandIcon';

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
      aria-label={`${title} panel`}
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
          <button
            type="button"
            title="Dock left"
            aria-label={`Dock ${title} left`}
            onClick={() => onSetDock('left')}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-xs)] text-[10px] font-semibold transition-colors ${
              dock === 'left'
                ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
            }`}
          >
            <BrandIcon name="arrow-left-to-line" size={16} />
          </button>
          <button
            type="button"
            title="Dock right"
            aria-label={`Dock ${title} right`}
            onClick={() => onSetDock('right')}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-xs)] text-[10px] font-semibold transition-colors ${
              dock === 'right'
                ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
            }`}
          >
            <BrandIcon name="arrow-right-to-line" size={16} />
          </button>
          <button
            type="button"
            title="Float window"
            aria-label={`Float ${title} panel`}
            onClick={() => onSetDock('float')}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-xs)] transition-colors ${
              dock === 'float'
                ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
            }`}
          >
            <BrandIcon name="float" size={14} />
          </button>
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
