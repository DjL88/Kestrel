import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { MoveHorizontal } from 'lucide-react';

import { FIT_VIEW, transformViewport, type ViewportPoint as Point } from '../core/viewportTransform';

interface Props {
  base: ReactNode;
  overlay?: ReactNode;
  overlayMode?: 'wipe' | 'full' | 'hidden';
  labels?: [string, string];
  zoom: number;
  pan: Point;
  onTransform: (zoom: number, pan: Point) => void;
}

export function PhotoViewport({ base, overlay, overlayMode = 'wipe', labels, zoom, pan, onTransform }: Props) {
  const [wipe, setWipe] = useState(50);
  const pointers = useRef(new Map<number, Point>());
  const view = useRef<HTMLDivElement>(null);
  const current = useRef({ zoom, pan });
  current.current = { zoom, pan };

  function transform(nextZoom: number, previous: Point, next: Point = previous) {
    if (!view.current) return;
    const updated = transformViewport(current.current, view.current.getBoundingClientRect(), nextZoom, previous, next);
    current.current = updated;
    onTransform(updated.zoom, updated.pan);
  }

  function track(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const before = [...pointers.current.values()];
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = [...pointers.current.values()];
    if (before.length === 1) {
      if (current.current.zoom > 1) transform(current.current.zoom, before[0], after[0]);
      return;
    }
    const midpoint = ([a, b]: Point[]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const distance = ([a, b]: Point[]) => Math.hypot(a.x - b.x, a.y - b.y);
    const ratio = distance(after) / Math.max(1, distance(before));
    transform(current.current.zoom * ratio, midpoint(before), midpoint(after));
  }

  function toggleZoom() {
    onTransform(zoom > 1 ? 1 : 2, FIT_VIEW.pan);
  }

  const layer = { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` };
  return (
    <div ref={view} className="relative min-h-0 flex-1 touch-none overflow-hidden bg-black"
      onPointerDown={(event) => {
        if (event.button !== 0 || pointers.current.size >= 2 ||
          (event.target instanceof Element && event.target.closest('button, input'))) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }}
      onPointerMove={track}
      onLostPointerCapture={(event) => pointers.current.delete(event.pointerId)}
      onPointerUp={(event) => pointers.current.delete(event.pointerId)}
      onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
      onDoubleClick={(event) => {
        if (event.target instanceof Element && event.target.closest('button, input')) return;
        transform(zoom > 1 ? 1 : 2, { x: event.clientX, y: event.clientY });
      }}
      onWheel={(event) => transform(current.current.zoom * (event.deltaY < 0 ? 1.15 : 0.87), { x: event.clientX, y: event.clientY })}
    >
      <div className="absolute inset-0" style={layer}>{base}</div>
      {overlay && (
        <>
          <div hidden={overlayMode === 'hidden'} className="pointer-events-none absolute inset-0 bg-black"
            style={{ clipPath: overlayMode === 'wipe' ? `inset(0 ${100 - wipe}% 0 0)` : undefined }}>
            <div className="absolute inset-0" style={layer}>{overlay}</div>
          </div>
          {overlayMode === 'wipe' && <>
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-white shadow" style={{ left: `${wipe}%` }} />
          <div role="slider" tabIndex={0} aria-label="Comparison wipe" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={wipe} aria-valuetext={`${wipe}% ${labels?.[0] ?? 'left image'}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId) || !view.current) return;
              const bounds = view.current.getBoundingClientRect();
              setWipe(Math.max(0, Math.min(100, Math.round((event.clientX - bounds.left) * 100 / bounds.width))));
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              let next: number;
              switch (event.key) {
                case 'ArrowLeft': case 'ArrowDown': next = wipe - 5; break;
                case 'ArrowRight': case 'ArrowUp': next = wipe + 5; break;
                case 'Home': next = 0; break;
                case 'End': next = 100; break;
                default: return;
              }
              event.preventDefault();
              event.stopPropagation();
              setWipe(Math.max(0, Math.min(100, next)));
            }}
            className="absolute top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border border-white/70 bg-black/75 focus-visible:outline-2 focus-visible:outline-sky-300"
            style={{ left: `clamp(22px, ${wipe}%, calc(100% - 22px))` }}>
            <MoveHorizontal className="h-5 w-5" aria-hidden="true" />
          </div>
          {labels && <span className="pointer-events-none absolute bottom-2 left-2 right-2 flex justify-between text-xs">
            {labels.map((label) => <span key={label} className="rounded bg-black/75 px-2 py-1">{label}</span>)}
          </span>}
          </>}
        </>
      )}
      <button type="button" onClick={toggleZoom} aria-label={zoom > 1 ? 'Fit photo' : 'Zoom in'} title={zoom > 1 ? 'Fit photo' : 'Zoom in'}
        className="absolute right-2 top-2 min-h-11 min-w-11 rounded-md bg-black/70 px-2 text-xs tabular-nums">
        {zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}
      </button>
    </div>
  );
}
