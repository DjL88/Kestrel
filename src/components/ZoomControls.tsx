import { percentFor, stepZoom, zoomForPercent } from '../core/zoomControls';

interface ZoomControlsProps {
  /** 1 is the whole photo fitted to the view. */
  zoom: number;
  /** Screen pixels per photo pixel when the whole photo fits. */
  fit: number;
  dpr: number;
  maxZoom: number;
  onZoom: (zoom: number) => void;
  /** The Eye button: one zoom to the eye (editor) or a mode that follows each photo (culling, `pressed`). */
  eye: { onClick: () => void; busy?: boolean; disabled?: boolean; pressed?: boolean; title: string };
  /** What the last Eye search found, in words. */
  note?: string | null;
  /** Leave out the slider and 200%, where the bar is shared with other actions. */
  compact?: boolean;
  className?: string;
}

/**
 * Zoom, in the same place and the same order wherever a single photo is shown (culling and editing): out, the level,
 * in, a slider, Fit, 100%, 200% and Eye. Every button is a full 44-pixel touch target. Only the view moves; edits and
 * decisions are never touched.
 */
export function ZoomControls({ zoom, fit, dpr, maxZoom, onZoom, eye, note, compact = false, className = '' }: ZoomControlsProps) {
  const ready = fit > 0;
  return (
    <div role="group" aria-label="Zoom" className={`flex shrink-0 items-center gap-0.5 rounded-md border border-white/10 px-1 text-xs text-zinc-100 ${className}`}>
      <button type="button" aria-label="Zoom out" title="Zoom out (-)" disabled={!ready} className="grid h-11 min-w-11 place-items-center rounded hover:bg-white/15 disabled:opacity-40"
        onClick={() => onZoom(stepZoom(zoom, -1, maxZoom))}>−</button>
      <span aria-live="polite" aria-label="Zoom level" className="min-w-10 text-center tabular-nums">{ready ? `${percentFor(zoom, fit, dpr)}%` : '—'}</span>
      <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={!ready} className="grid h-11 min-w-11 place-items-center rounded hover:bg-white/15 disabled:opacity-40"
        onClick={() => onZoom(stepZoom(zoom, 1, maxZoom))}>+</button>
      {!compact && <input type="range" min={1} max={Math.max(1.01, maxZoom)} step={(Math.max(1.01, maxZoom) - 1) / 200} value={zoom} disabled={!ready}
        aria-label="Zoom amount" onChange={(event) => onZoom(event.target.valueAsNumber)}
        className="min-h-11 w-20 accent-sky-300 desk:min-h-9" />}
      <button type="button" title="Fit to screen" className="h-11 min-w-11 rounded px-1.5 hover:bg-white/15" onClick={() => onZoom(1)}>Fit</button>
      <button type="button" title="Actual pixels" disabled={!ready} className="h-11 min-w-11 rounded px-1.5 hover:bg-white/15 disabled:opacity-40"
        onClick={() => onZoom(zoomForPercent(100, fit, dpr))}>100%</button>
      {!compact && <button type="button" title="Twice actual pixels" disabled={!ready} className="h-11 min-w-11 rounded px-1.5 hover:bg-white/15 disabled:opacity-40"
        onClick={() => onZoom(zoomForPercent(200, fit, dpr))}>200%</button>}
      <button type="button" aria-label="Eye" aria-busy={eye.busy || undefined} title={eye.title} aria-pressed={eye.pressed} disabled={eye.disabled}
        className="h-11 min-w-11 rounded px-1.5 hover:bg-white/15 aria-pressed:bg-white/15 disabled:opacity-40" onClick={eye.onClick}>{eye.busy ? 'Eye…' : 'Eye'}</button>
      {note && <span role="status" className="max-w-56 truncate px-1 text-xs text-zinc-300">{note}</span>}
    </div>
  );
}
