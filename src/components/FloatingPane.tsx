import { useEffect, useRef, useState, type ReactNode, type PointerEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, PanelRightClose } from 'lucide-react';

interface FloatingPaneProps {
  title: string;
  storageKey: string;
  onDock: () => void;
  children: ReactNode;
}

export interface PaneRect { x: number; y: number; width: number; height: number }
const MIN_WIDTH = 280;
const MIN_HEIGHT = 250;
const GAP = 12;

export function clampPaneRect(rect: PaneRect, viewport: { width: number; height: number }): PaneRect {
  const width = Math.min(Math.max(MIN_WIDTH, Number.isFinite(rect.width) ? rect.width : 360), Math.max(MIN_WIDTH, viewport.width - GAP * 2));
  const height = Math.min(Math.max(MIN_HEIGHT, Number.isFinite(rect.height) ? rect.height : 560), Math.max(MIN_HEIGHT, viewport.height - GAP * 2));
  return {
    width, height,
    x: Math.max(GAP, Math.min(Number.isFinite(rect.x) ? rect.x : GAP, Math.max(GAP, viewport.width - width - GAP))),
    y: Math.max(GAP, Math.min(Number.isFinite(rect.y) ? rect.y : GAP, Math.max(GAP, viewport.height - height - GAP))),
  };
}

function initialRect(key: string): PaneRect {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const fallback = { x: Math.max(GAP, viewport.width - 390), y: 72, width: 360, height: 570 };
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
export function FloatingPane({ title, storageKey, onDock, children }: FloatingPaneProps) {
  const [rect, setRect] = useState<PaneRect>(() => initialRect(storageKey));
  const [maximised, setMaximised] = useState(false);
  const drag = useRef<{ pointer: number; x: number; y: number; rect: PaneRect } | null>(null);
  const frame = useRef<HTMLElement>(null);

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
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId || maximised) return;
    setRect(clampPaneRect({ ...start.rect, x: start.rect.x + event.clientX - start.x, y: start.rect.y + event.clientY - start.y },
      { width: window.innerWidth, height: window.innerHeight }));
  };
  const moveKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (maximised || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? 40 : 12;
    setRect((current) => clampPaneRect({ ...current,
      x: current.x + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0),
      y: current.y + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0),
    }, { width: window.innerWidth, height: window.innerHeight }));
  };
  const measureResize = () => {
    if (maximised || !frame.current) return;
    const bounds = frame.current.getBoundingClientRect();
    setRect((current) => clampPaneRect({ ...current, width: bounds.width, height: bounds.height },
      { width: window.innerWidth, height: window.innerHeight }));
  };
  return createPortal(
    <section ref={frame} aria-label={title} data-floating-pane={storageKey}
      className="fixed z-[75] flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/25 bg-kestrel-panel shadow-2xl"
      style={maximised
        ? { inset: GAP, width: 'auto', height: 'auto' }
        : { left: rect.x, top: rect.y, width: rect.width, height: rect.height, resize: 'both', maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 24px)' }}
      onPointerUp={measureResize} onPointerCancel={measureResize}>
      <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-white/15 bg-kestrel-raised px-2">
        <div role="button" tabIndex={0} aria-label={`Move ${title}; use arrow keys`} title={`Drag to move ${title}, or use arrow keys`}
          className="flex min-h-11 min-w-0 flex-1 touch-none cursor-move items-center px-2 text-sm font-semibold text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300"
          onKeyDown={moveKeyboard}
          onPointerDown={(event) => {
            if (maximised || event.button !== 0) return;
            drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, rect };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
          <span className="truncate">{title}</span>
        </div>
        <button type="button" onClick={() => setMaximised((value) => !value)}
          aria-label={maximised ? `Restore ${title} panel size` : `Maximise ${title} panel`}
          className="grid h-11 w-11 place-items-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
          {maximised ? <Minimize2 className="h-4 w-4" aria-hidden="true"/> : <Maximize2 className="h-4 w-4" aria-hidden="true"/>}
        </button>
        <button type="button" onClick={onDock} aria-label={`Dock ${title}`}
          className="grid h-11 w-11 place-items-center rounded-md hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
          <PanelRightClose className="h-4 w-4" aria-hidden="true"/>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>, document.body,
  );
}
