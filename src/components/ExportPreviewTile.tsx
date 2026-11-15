import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { framingFor, shapeLabel, toProfile, type BarStyle, type ExportFormat } from '../core/exportFormats';
import type { FocusPoint } from '../core/exportFraming';
import type { PhotoFrame } from '../core/types';
import { renderExportPreview } from '../providers/browserExport';

interface Props {
  frame: PhotoFrame;
  source: HTMLImageElement | undefined;
  format: ExportFormat;
  bars: BarStyle;
  anchor: FocusPoint;
  onAnchor: (anchor: FocusPoint) => void;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * A small picture of one photo in one format, drawn by the same code that makes the file.
 * When the format crops, drag the picture (or use the arrow keys) to choose what stays in.
 */
export function ExportPreviewTile({ frame, source, format, bars, anchor, onAnchor }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  // How far the crop moves for a drag across the tile, as a share of the photo.
  const reach = useRef({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; anchor: FocusPoint } | null>(null);
  const movable = format.fit === 'fill' && format.width > 0;

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    // A short pause lets a drag settle before the next picture is drawn.
    const timer = window.setTimeout(async () => {
      try {
        const small = await renderExportPreview(source, frame, toProfile(format), framingFor(format.fit), { focus: anchor, bars });
        if (cancelled || !canvas.current) return;
        canvas.current.width = small.width;
        canvas.current.height = small.height;
        canvas.current.getContext('2d')!.drawImage(small, 0, 0);
        // The crop covers this share of the photo, so a drag across the tile moves it by that much.
        const photoShare = source.naturalWidth && source.naturalHeight && format.width && format.height
          ? Math.min(1, (source.naturalHeight * (format.width / format.height)) / source.naturalWidth) : 1;
        const photoShareY = source.naturalWidth && source.naturalHeight && format.width && format.height
          ? Math.min(1, (source.naturalWidth / (format.width / format.height)) / source.naturalHeight) : 1;
        reach.current = { x: photoShare, y: photoShareY };
        setFailed(false);
        setBusy(false);
      } catch {
        if (!cancelled) { setFailed(true); setBusy(false); }
      }
    }, 60);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [source, frame, format.id, format.fit, format.width, format.height, bars, anchor.x, anchor.y]);

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || !canvas.current) return;
    const box = canvas.current.getBoundingClientRect();
    // Dragging the picture right moves the crop left across the photo.
    onAnchor({
      x: clamp(start.anchor.x - ((event.clientX - start.x) / box.width) * reach.current.x),
      y: clamp(start.anchor.y - ((event.clientY - start.y) / box.height) * reach.current.y),
    });
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.03;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    onAnchor({ x: clamp(anchor.x + delta[0]), y: clamp(anchor.y + delta[1]) });
  };

  // Most labels already name their shape. Keep-shape and custom ones do not, so add it.
  const shape = format.width ? shapeLabel(format.width, format.height) : '';
  const caption = shape && !format.label.includes(shape) ? `${format.label} · ${shape}` : format.label;
  const hint = !movable ? (format.fit === 'bars' ? 'Whole photo, with borders' : 'Keeps the photo’s own shape') : 'Drag to choose what stays in';
  return (
    <figure className="flex flex-col gap-1">
      <div role={movable ? 'group' : undefined} tabIndex={movable ? 0 : undefined}
        aria-label={movable ? `Crop position for ${frame.filename} as ${caption}. Arrow keys move it.` : undefined}
        title={movable ? 'Drag to move the crop, double-click to centre it' : undefined}
        onKeyDown={movable ? key : undefined}
        onDoubleClick={movable ? () => onAnchor({ x: 0.5, y: 0.5 }) : undefined}
        onPointerDown={movable ? (event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, anchor }; } : undefined}
        onPointerMove={movable ? move : undefined}
        onPointerUp={movable ? () => { drag.current = null; } : undefined}
        onPointerCancel={movable ? () => { drag.current = null; } : undefined}
        className={`relative grid h-40 touch-none place-items-center overflow-hidden rounded-md bg-black/40 ${movable ? 'cursor-grab focus-visible:outline-2 focus-visible:outline-sky-300 active:cursor-grabbing' : ''}`}>
        <canvas ref={canvas} aria-label={`Preview of ${frame.filename} as ${caption}`} role="img" className={`max-h-full max-w-full ${busy ? 'opacity-40' : ''}`} />
        {busy && !failed && <span className="absolute text-xs text-zinc-300" role="status">Drawing…</span>}
        {failed && <span className="absolute px-2 text-center text-xs text-orange-200" role="status">Could not draw this preview</span>}
      </div>
      <figcaption className="text-xs text-zinc-300"><span className="block truncate">{frame.filename}</span><span className="block text-zinc-400">{caption}. {hint}.</span></figcaption>
    </figure>
  );
}
