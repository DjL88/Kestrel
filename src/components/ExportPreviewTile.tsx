import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Minus, Plus, RectangleHorizontal } from 'lucide-react';
import { canTurn, framingFor, shapeLabel, toProfile, type BarStyle, type ExportFormat } from '../core/exportFormats';
import { MAX_ZOOM, clampAnchor, clampZoom, planExportFraming, type FocusPoint } from '../core/exportFraming';
import { DEFAULT_FRAMING, framedSize } from '../core/photoFraming';
import type { SocialIconId } from '../core/socialIcons';
import type { PhotoFrame } from '../core/types';
import { drawCropQuickly, renderExportPreview } from '../providers/browserExport';
import type { OverlayOptions } from '../core/exportOverlay';
import { SocialIcon } from './SocialIcon';
import { exportText as t } from '../i18n/areas/export';
import { formatLabel } from '../i18n/areas/export/labels';
import { AdjustmentSlider } from './AdjustmentSlider';

interface Props {
  frame: PhotoFrame;
  source: HTMLImageElement | undefined;
  format: ExportFormat;
  bars: BarStyle;
  anchor: FocusPoint;
  zoom: number;
  onAnchor: (anchor: FocusPoint) => void;
  onZoom: (zoom: number) => void;
  /** Turns the shape on its side (4:5 to 5:4). Absent when the format cannot be turned. */
  onTurn?: () => void;
  platform?: SocialIconId;
  /** Shooting details printed on the picture, shown in the preview too. */
  overlay?: OverlayOptions;
  /** A taller picture, for when it is the one thing on the screen. */
  large?: boolean;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * One photo in one format, drawn by the same code that makes the file. When the format crops, drag the picture in any
 * direction to choose what stays in, and zoom in to look closer. While a finger or mouse is down the picture is drawn
 * quickly without the edit, and the finished one replaces it as soon as it lets go.
 */
export function ExportPreviewTile({ frame, source, format, bars, anchor, zoom, onAnchor, onZoom, onTurn, platform, overlay, large = false }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; anchor: FocusPoint; zoom: number; spread: number } | null>(null);
  const frameRequest = useRef(0);
  const movable = format.fit === 'fill' && format.width > 0;

  /** How much of the photo the crop covers, so a drag can be turned into a move. */
  const span = (useZoom: number) => {
    if (!source) return null;
    const { width, height } = framedSize(source.naturalWidth, source.naturalHeight, frame.framing ?? DEFAULT_FRAMING);
    const { region } = planExportFraming(width, height, toProfile(format), 'focus', anchor, undefined, useZoom);
    return { width, height, region };
  };

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const small = await renderExportPreview(source, frame, toProfile(format), framingFor(format.fit), { focus: anchor, bars, zoom, overlay }, undefined);
        if (cancelled || !canvas.current) return;
        canvas.current.width = small.width;
        canvas.current.height = small.height;
        canvas.current.getContext('2d')!.drawImage(small, 0, 0);
        setFailed(false);
        setBusy(false);
      } catch {
        if (!cancelled) { setFailed(true); setBusy(false); }
      }
    }, 60);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [source, frame, format.id, format.fit, format.width, format.height, bars, zoom, anchor.x, anchor.y, JSON.stringify(overlay)]);

  const quickDraw = (next: FocusPoint, nextZoom: number) => {
    cancelAnimationFrame(frameRequest.current);
    frameRequest.current = requestAnimationFrame(() => {
      if (!source || !canvas.current) return;
      drawCropQuickly(source, frame, toProfile(format), { focus: next, zoom: nextZoom }, canvas.current);
    });
  };
  useEffect(() => () => cancelAnimationFrame(frameRequest.current), []);

  /** A position that stays inside the range where moving the crop has an effect. */
  const settle = (point: FocusPoint, useZoom: number): FocusPoint => {
    const info = span(useZoom);
    if (!info) return { x: clamp(point.x), y: clamp(point.y) };
    return { x: clampAnchor(point.x, info.width, info.region.width), y: clampAnchor(point.y, info.height, info.region.height) };
  };

  const down = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    gesture.current = { x: event.clientX, y: event.clientY, anchor: settle(anchor, zoom), zoom,
      spread: points.length === 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0 };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current;
    if (!start || !canvas.current || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    let nextZoom = zoom;
    if (points.length === 2 && start.spread > 0) {
      // Pinch: the distance between two fingers sets the zoom.
      nextZoom = clampZoom(start.zoom * (Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / start.spread));
    }
    const info = span(nextZoom);
    if (!info) return;
    const box = canvas.current.getBoundingClientRect();
    // Dragging the picture right moves the crop left across the photo, by the share of the photo the crop covers.
    const next = settle({
      x: start.anchor.x - ((event.clientX - start.x) / box.width) * (info.region.width / info.width),
      y: start.anchor.y - ((event.clientY - start.y) / box.height) * (info.region.height / info.height),
    }, nextZoom);
    live.current = { anchor: next, zoom: nextZoom };
    quickDraw(next, nextZoom);
  };
  const live = useRef<{ anchor: FocusPoint; zoom: number } | null>(null);
  const up = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      if (live.current) {
        onAnchor(live.current.anchor);
        if (live.current.zoom !== zoom) onZoom(live.current.zoom);
        live.current = null;
      }
    } else {
      // One finger of a pinch lifted: carry on dragging from where the other one is.
      const rest = [...pointers.current.values()][0];
      gesture.current = { x: rest.x, y: rest.y, anchor: live.current?.anchor ?? anchor, zoom: live.current?.zoom ?? zoom, spread: 0 };
    }
  };

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.03;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (event.key === '+' || event.key === '=') { event.preventDefault(); onZoom(clampZoom(zoom + 0.25)); return; }
    if (event.key === '-') { event.preventDefault(); onZoom(clampZoom(zoom - 0.25)); return; }
    if (!delta) return;
    event.preventDefault();
    onAnchor(settle({ x: anchor.x + delta[0], y: anchor.y + delta[1] }, zoom));
  };

  const shape = format.width ? shapeLabel(format.width, format.height) : '';
  const label = formatLabel(format);
  const caption = shape && !label.includes(shape) ? `${label} · ${shape}` : label;
  const hint = !movable ? (format.fit === 'bars' ? t.tile.hintBars : t.tile.hintKeep) : t.tile.hintMove;
  return (
    <figure className="flex flex-col gap-1">
      <div className="relative">
        <div role={movable ? 'group' : undefined} tabIndex={movable ? 0 : undefined}
          aria-label={movable ? t.tile.cropPosition(frame.filename, caption) : undefined}
          title={movable ? t.tile.dragTitle : undefined}
          onKeyDown={movable ? key : undefined}
          onDoubleClick={movable ? () => { onAnchor({ x: 0.5, y: 0.5 }); onZoom(1); } : undefined}
          onPointerDown={movable ? down : undefined} onPointerMove={movable ? move : undefined}
          onPointerUp={movable ? up : undefined} onPointerCancel={movable ? up : undefined}
          className={`relative grid ${large ? 'h-[min(46dvh,30rem)]' : 'h-48'} touch-none place-items-center overflow-hidden rounded-md bg-zinc-700/50 ${movable ? 'cursor-grab focus-visible:outline-2 focus-visible:outline-sky-300 active:cursor-grabbing' : ''}`}>
          <canvas ref={canvas} aria-label={t.tile.previewOf(frame.filename, caption)} role="img" className={`max-h-full max-w-full shadow-[0_0_0_1px_rgba(255,255,255,0.55),0_4px_18px_rgba(0,0,0,0.5)] ${busy ? 'opacity-40' : ''}`} />
          {busy && !failed && <span className="absolute text-xs text-zinc-300" role="status">{t.tile.drawing}</span>}
          {failed && <span className="absolute px-2 text-center text-xs text-orange-200" role="status">{t.tile.failed}</span>}
        </div>
        {platform && (
          <span className="pointer-events-none absolute left-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-zinc-100" aria-hidden="true">
            <SocialIcon id={platform} className="h-4 w-4" />
          </span>
        )}
        {onTurn && canTurn(format) && (
          <button type="button" onClick={onTurn} className="absolute right-1.5 top-1.5 inline-flex min-h-11 items-center gap-1 rounded-full bg-black/65 px-3 desk:min-h-9 text-xs text-zinc-100 hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-sky-300"
            aria-label={t.tile.turn(caption)} title={t.tile.turnTitle}>
            <RectangleHorizontal className={`h-4 w-4 ${format.height > format.width ? 'rotate-90' : ''}`} aria-hidden="true" />{shape}
          </button>
        )}
      </div>
      {movable && (
        <div className="flex flex-wrap items-center gap-1">
          <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/10 desk:h-9 desk:w-9" aria-label={t.tile.zoomOut} onClick={() => onZoom(clampZoom(zoom - 0.25))}><Minus className="h-4 w-4" aria-hidden="true" /></button>
          <input type="range" min={1} max={MAX_ZOOM} step={0.05} value={zoom} aria-label={t.tile.zoom(caption)} onChange={(event) => onZoom(clampZoom(event.target.valueAsNumber))} className="min-h-11 min-w-[7rem] flex-1 accent-sky-300 desk:min-h-9" />
          <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/10 desk:h-9 desk:w-9" aria-label={t.tile.zoomIn} onClick={() => onZoom(clampZoom(zoom + 0.25))}><Plus className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/10 desk:h-9 desk:w-9" aria-label="Zoom out" onClick={() => onZoom(clampZoom(zoom - 0.25))}><Minus className="h-4 w-4" aria-hidden="true" /></button>
          <div className="min-w-[7rem] flex-1">
            <AdjustmentSlider label={`Zoom ${caption}`} min={1} max={MAX_ZOOM} step={0.05} neutral={1}
              value={zoom} displayValue={`${Math.round(zoom * 100)}%`}
              onChange={(value) => onZoom(clampZoom(value))} />
          </div>
          <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/10 desk:h-9 desk:w-9" aria-label="Zoom in" onClick={() => onZoom(clampZoom(zoom + 0.25))}><Plus className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      )}
      <figcaption className="text-xs text-zinc-300"><span className="block truncate">{frame.filename}</span><span className="block text-zinc-400">{caption}. {hint}.</span></figcaption>
    </figure>
  );
}
