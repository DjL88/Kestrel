import React, { useRef, useState } from 'react';
import { STRINGS } from '../strings';
import { clamp } from '../utils/studioMath';

interface CompareSplitProps {
  before: React.ReactNode;
  after: React.ReactNode;
}

/**
 * Before and After on one picture, with a draggable split. The handle is a real slider: drag it, or use the arrow keys
 * (Shift for larger steps, Home and End for the ends). Both halves are the same photo, so the split only reveals the edit.
 */
export default function CompareSplit({ before, after }: CompareSplitProps) {
  const [pct, setPct] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const rounded = Math.round(pct);

  const moveTo = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (rect && rect.width > 0) setPct(clamp(((clientX - rect.left) / rect.width) * 100, 0, 100));
  };

  return (
    <div ref={box} className="absolute inset-0" data-testid="compare-split">
      <div className="absolute inset-0">{after}</div>
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>{before}</div>
      {pct > 14 && (
        <span className="pointer-events-none absolute left-2.5 top-2.5 rounded bg-[var(--bg-scrim)] px-2 py-0.5 text-[10px] font-semibold text-white">
          {STRINGS.canvas.beforeLabel}
        </span>
      )}
      {pct < 86 && (
        <span className="pointer-events-none absolute right-2.5 top-2.5 rounded bg-[var(--brand-accent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-on-accent)]">
          {STRINGS.canvas.afterLabel}
        </span>
      )}
      <div
        role="slider"
        tabIndex={0}
        aria-label={STRINGS.canvas.compareSplitLabel}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        aria-valuetext={STRINGS.canvas.compareSplitValue(rounded)}
        className="absolute bottom-0 top-0 -ml-5 flex w-10 cursor-ew-resize touch-none items-center justify-center focus-visible:outline-none"
        style={{ left: `${pct}%` }}
        onPointerDown={(event) => {
          event.stopPropagation();
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => { if (dragging.current) moveTo(event.clientX); }}
        onPointerUp={(event) => { dragging.current = false; event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { dragging.current = false; }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 2;
          const next = event.key === 'ArrowLeft' ? pct - step : event.key === 'ArrowRight' ? pct + step
            : event.key === 'Home' ? 0 : event.key === 'End' ? 100 : null;
          if (next === null) return;
          event.preventDefault();
          event.stopPropagation();
          setPct(clamp(next, 0, 100));
        }}
      >
        <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" />
        <span aria-hidden="true" className="relative grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-[var(--bg-scrim)] text-[13px] font-bold text-white shadow-lg">◂▸</span>
      </div>
    </div>
  );
}
