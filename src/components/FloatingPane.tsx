import { useEffect, useRef, useState, type ReactNode, type PointerEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Grip, Expand, Shrink, PanelRightClose, Pin } from 'lucide-react';
import { clampPaneRect, defaultPaneRect, dockZoneAt, FLOATING_PANE_GAP as GAP, type PaneRect } from '../core/floatingPaneGeometry';
import { FLOATING_PANE_Z } from '../core/photoInfoLayout';
import { libraryText as t } from '../i18n/areas/library';

interface FloatingPaneProps {
  title: string;
  storageKey: string;
  onDock: () => void;
  /** Letting go on a window edge docks the panel on that side (the caller moves the dock to match). */
  onDockTo?: (side: 'left' | 'right') => void;
  /** Optional focus return once the docked control is visible again. */
  dockFocusSelector?: string;
  initialSide?: 'left' | 'right';
  /** First-open position only: stay clear of a docked panel this wide, and nudge by this many panels. */
  initialAvoidPx?: number;
  initialIndex?: number;
  photoOnly?: boolean;
  children: ReactNode;
}

function initialRect(key: string, initialSide: 'left' | 'right', avoidPx?: number, index?: number): PaneRect {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const fallback = avoidPx === undefined
    ? { x: initialSide === 'left' ? GAP : Math.max(GAP, viewport.width - 390), y: 72, width: 360, height: 570 }
    : defaultPaneRect(viewport, initialSide, { avoidPx, index });
  try {
    const stored = window.localStorage.getItem(key);
    if (stored) {
      const value: unknown = JSON.parse(stored);
      if (value && typeof value === 'object' && ['x', 'y', 'width', 'height'].every((field) => typeof (value as Record<string, unknown>)[field] === 'number')) {
        return clampPaneRect(value as PaneRect, viewport);
      }
    }
  } catch { /* Private storage must not prevent editing. */ }
  return clampPaneRect(fallback, viewport);
}

/** One movable, resizable, keyboard-accessible floating tool frame for desktop.
 * It is a portal, so a detached panel never reduces the photograph's stage
 * dimensions or gets clipped by the Library/Review/Edit flex layout.
 * The calling screen stays responsible for compact phone/tablet sheets.
 */
export function FloatingPane({ title, storageKey, onDock, onDockTo, dockFocusSelector, initialSide = 'right', initialAvoidPx, initialIndex, photoOnly = false, children }: FloatingPaneProps) {
  const [rect, setRect] = useState<PaneRect>(() => initialRect(storageKey, initialSide, initialAvoidPx, initialIndex));
  const pinKey = `${storageKey}-photo-only`;
  const [pinned, setPinned] = useState(() => {
    try { return localStorage.getItem(pinKey) === 'true'; } catch { return false; }
  });
  const visible = !photoOnly || pinned;
  const [maximised, setMaximised] = useState(false);
  const [dockZone, setDockZone] = useState<'left' | 'right' | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointer: number; x: number; y: number; rect: PaneRect } | null>(null);
  const resizeDrag = useRef<{ pointer: number; x: number; y: number; rect: PaneRect } | null>(null);
  const ignoreResizeClick = useRef(false);
  const frame = useRef<HTMLElement>(null);
  // Panels are working surfaces, not modal dialogs. Clicked/focused panel comes
  // forward, but always stays BELOW Save, Export and Settings modal overlays.
  const bringToFront = () => {
    if (!frame.current) return;
    for (const pane of document.querySelectorAll<HTMLElement>('[data-floating-pane]')) {
      pane.style.zIndex = String(pane === frame.current ? FLOATING_PANE_Z.foreground : FLOATING_PANE_Z.background);
    }
  };
  const dock = () => {
    onDock();
    if (dockFocusSelector) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(dockFocusSelector)?.focus());
    }
  };
  useEffect(() => {
    if (!visible) return;
    frame.current?.querySelector<HTMLElement>('[data-pane-drag-handle]')?.focus();
    bringToFront();
    // The frame remains a normal region in the tab order; it is not a focus trap.
  }, [visible]);

  useEffect(() => {
    const onResize = () => setRect((current) => clampPaneRect(current, { width: window.innerWidth, height: window.innerHeight }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(rect)); }
    catch { /* Device-local preferences are optional. */ }
  }, [rect, storageKey]);

  const stopDrag = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    setDockZone(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const dropDrag = (event: PointerEvent<HTMLElement>) => {
    const zone = onDockTo && drag.current?.pointer === event.pointerId && !maximised ? dockZoneAt(event.clientX, window.innerWidth) : null;
    stopDrag(event);
    if (zone) { onDockTo?.(zone); dock(); }
  };
  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId || maximised) return;
    if (onDockTo) setDockZone(dockZoneAt(event.clientX, window.innerWidth));
    setDragging(true);
    setRect(clampPaneRect({ ...start.rect, x: start.rect.x + event.clientX - start.x, y: start.rect.y + event.clientY - start.y },
      { width: window.innerWidth, height: window.innerHeight }));
  };
  const moveKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (maximised || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const amount = event.shiftKey ? 40 : 12;
    setRect((current) => clampPaneRect({ ...current,
      x: current.x + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0),
      y: current.y + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0),
    }, { width: window.innerWidth, height: window.innerHeight }));
  };
  // An explicit grip works with mouse, pen and touch (native CSS `resize` does not
  // consistently expose a handle on tablets). The same control supports arrows.
  const resizeBy = (width: number, height: number) => setRect((current) => clampPaneRect({ ...current,
    width: current.width + width, height: current.height + height,
  }, { width: window.innerWidth, height: window.innerHeight }));
  const stopResize = (event: PointerEvent<HTMLButtonElement>) => {
    if (resizeDrag.current?.pointer !== event.pointerId) return;
    resizeDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  if (!visible) return null;
  return (
    <>
    {createPortal(
    <section ref={frame} aria-label={title} data-floating-pane={storageKey}
      className="fixed z-40 flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/25 bg-kestrel-panel shadow-2xl"
      style={maximised
        ? { inset: GAP, width: 'auto', height: 'auto' }
        : { left: rect.x, top: rect.y, width: rect.width, height: rect.height, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 24px)' }}
      onPointerDownCapture={bringToFront}
      onFocusCapture={bringToFront}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        if (event.target instanceof Element && event.target.closest('input, textarea, select, [role="dialog"], [role="listbox"], [contenteditable="true"]')) return;
        event.preventDefault();
        event.stopPropagation();
        dock();
      }}
>
      <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-white/15 bg-kestrel-raised px-2">
        <div role="button" data-pane-drag-handle tabIndex={0} aria-label={t.floatingPane.move(title)} title={t.floatingPane.drag(title)}
          className="flex min-h-11 min-w-0 flex-1 touch-none cursor-move items-center px-2 text-sm font-semibold text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300"
          onKeyDown={moveKeyboard}
          onPointerDown={(event) => {
            if (maximised || event.button !== 0) return;
            event.currentTarget.focus();
            drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, rect };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={moveDrag} onPointerUp={dropDrag} onPointerCancel={stopDrag}>
          <span className="truncate">{title}</span>
        </div>
        <button type="button" onClick={() => setMaximised((value) => !value)}
          aria-label={maximised ? t.floatingPane.restore(title) : t.floatingPane.maximise(title)}
          className="grid h-11 w-11 place-items-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
          {maximised ? <Shrink className="h-4 w-4" aria-hidden="true"/> : <Expand className="h-4 w-4" aria-hidden="true"/>}
        </button>
        <button type="button" aria-pressed={pinned}
          aria-label={t.floatingPane.pin(title)} title={t.floatingPane.pin(title)}
          onClick={() => {
            setPinned(!pinned);
            try { localStorage.setItem(pinKey, String(!pinned)); } catch { /* Optional preference. */ }
          }}
          className="grid h-11 w-11 place-items-center rounded-md hover:bg-white/10 aria-pressed:bg-white/20 focus-visible:outline-2 focus-visible:outline-sky-300">
          <Pin className={`h-4 w-4 ${pinned ? 'fill-current' : ''}`} aria-hidden="true" />
        </button>
        <button type="button" onClick={dock} aria-label={t.floatingPane.dock(title)}
          className="grid h-11 w-11 place-items-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
          <PanelRightClose className="h-4 w-4" aria-hidden="true"/>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      {!maximised && <button type="button" data-pane-resize-handle
        aria-label={t.floatingPane.resize(title)} title={t.floatingPane.resize(title)}
        className="absolute bottom-0 right-0 z-10 grid h-9 w-9 touch-none place-items-center rounded-tl-md border-l border-t border-white/20 bg-kestrel-raised/95 text-zinc-300 cursor-se-resize hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-sky-300"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          ignoreResizeClick.current = false;
          resizeDrag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, rect };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = resizeDrag.current;
          if (!start || start.pointer !== event.pointerId) return;
          const dx = event.clientX - start.x, dy = event.clientY - start.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) ignoreResizeClick.current = true;
          setRect(clampPaneRect({ ...start.rect, width: start.rect.width + dx, height: start.rect.height + dy },
            { width: window.innerWidth, height: window.innerHeight }));
        }}
        onPointerUp={stopResize} onPointerCancel={stopResize}
        onClick={() => {
          if (ignoreResizeClick.current) { ignoreResizeClick.current = false; return; }
          resizeBy(30, 30);
        }}
        onKeyDown={(event) => {
          const amount = event.shiftKey ? 40 : 16;
          const dx = event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0;
          const dy = event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0;
          if (!dx && !dy) return;
          event.preventDefault();
          event.stopPropagation();
          resizeBy(dx, dy);
        }}>
        <Grip className="h-4 w-4" aria-hidden="true" />
      </button>}
    </section>, document.body)}
    {dragging && onDockTo && createPortal(
      <div aria-hidden="true" className="pointer-events-none fixed inset-0" style={{ zIndex: FLOATING_PANE_Z.foreground - 1 }}>
        {(['left', 'right'] as const).map((side) => (
          <div key={side} data-dock-zone={side}
            className={`absolute inset-y-3 flex w-[72px] items-center justify-center rounded-lg border-2 border-dashed text-xs font-medium transition-colors duration-150 ${side === 'left' ? 'left-1' : 'right-1'} ${dockZone === side ? 'border-sky-300 bg-sky-300/25 text-sky-50' : 'border-white/25 bg-white/5 text-zinc-300'}`}>
            <span className="[writing-mode:vertical-rl]">{side === 'left' ? t.floatingPane.dockLeft : t.floatingPane.dockRight}</span>
          </div>
        ))}
      </div>, document.body)}
    </>
  );
}
