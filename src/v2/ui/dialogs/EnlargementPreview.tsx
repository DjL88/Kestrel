import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { STRINGS } from '../strings';
import type { EnlargementPreviewResult } from '../../engineClient/enlargementPreview';

interface Props {
  /** Null while the picture is being made. */
  result: EnlargementPreviewResult | null;
  /** The format being previewed, as the Formats panel names it. */
  formatLabel: string;
  onClose: () => void;
}

/**
 * The exported picture of one format, Output scale included, shown at 100% (one picture pixel per screen pixel). It is
 * made by the export's own renderer, so it is what export will save, not a stand-in.
 */
export default function EnlargementPreview({ result, formatLabel, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);
  // Start in the middle of the picture, where the subject usually is.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || !result?.ok) return;
    view.scrollLeft = Math.max(0, (result.width - view.clientWidth) / 2);
    view.scrollTop = Math.max(0, (result.height - view.clientHeight) / 2);
  }, [result]);
  const t = STRINGS.panelWords;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--bg-scrim)] p-2 sm:p-4"
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
      <section role="dialog" aria-modal="true" aria-labelledby="v2-enlargement-title" data-testid="v2-enlargement-preview"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col gap-3 rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 text-[var(--text-primary)] shadow-[var(--shadow-panel)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="v2-enlargement-title" className="text-base font-semibold">{t.enlargementTitle}</h2>
            <p className="text-xs text-[var(--text-secondary)]">
              {formatLabel}{result?.ok ? ` · ${result.width} × ${result.height} ${t.enlargementPixels}` : ''}
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t.enlargementClose}
            className="min-h-9 shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs font-medium">
            {t.enlargementClose}
          </button>
        </div>
        {!result && <p role="status" className="text-sm text-[var(--text-secondary)]">{t.enlargementWorking}</p>}
        {result && !result.ok && <p role="alert" className="text-sm">{`${t.enlargementFailed}: ${result.message}`}</p>}
        {result?.ok && <>
          <p className="text-xs text-[var(--text-secondary)]">{t.enlargementShown} {t.enlargementPng}</p>
          <div ref={viewRef} data-testid="v2-enlargement-view" tabIndex={0} aria-label={t.enlargementTitle}
            className="min-h-0 flex-1 cursor-grab overflow-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] active:cursor-grabbing"
            style={{ height: 'min(70dvh, 900px)' }}
            onPointerDown={(event) => { const view = viewRef.current; if (view) drag.current = { x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop }; }}
            onPointerMove={(event) => { const view = viewRef.current; const from = drag.current; if (view && from && event.buttons) { view.scrollLeft = from.left - (event.clientX - from.x); view.scrollTop = from.top - (event.clientY - from.y); } }}
            onPointerUp={() => { drag.current = null; }}>
            {/* Natural size, never scaled by the browser: one picture pixel per CSS pixel. */}
            <img src={result.url} alt={t.enlargementTitle} draggable={false} data-testid="v2-enlargement-image"
              width={result.width} height={result.height} style={{ width: result.width, height: result.height, maxWidth: 'none', imageRendering: 'auto' }} />
          </div>
        </>}
      </section>
    </div>
  );
}
