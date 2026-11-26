import React, { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../utils/dialogFocus';
import { STRINGS } from '../strings';
import { fitCheckerCalibration, patchCentres, samplePatches, type CheckerCorners, type CheckerFit } from '../../../core/colourChecker';

const C = STRINGS.adjust.calibration;
const MAX_EDGE = 1600;

/**
 * Match a colour checker: the photo, four draggable marks for the corner patches and the grid they make. Matching fits
 * the camera calibration sliders (one reversible edit); the photo's pixels and the original are never changed.
 */
export default function ColourCheckerDialog({ pictureUrl, onApply, onClose }: {
  pictureUrl: string;
  onApply: (fit: CheckerFit) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onKeyDown = useDialogFocus(true, panelRef, onClose);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // Marks as shares of the picture, so they stay put whatever size the picture is shown at.
  const [marks, setMarks] = useState<CheckerCorners>([{ x: 0.2, y: 0.25 }, { x: 0.8, y: 0.25 }, { x: 0.8, y: 0.75 }, { x: 0.2, y: 0.75 }]);
  const [error, setError] = useState('');
  const dragging = useRef<number | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d', { willReadFrequently: true })?.drawImage(img, 0, 0, canvas.width, canvas.height);
      setSize({ width: canvas.width, height: canvas.height });
    };
    img.src = pictureUrl;
  }, [pictureUrl]);

  const labels = [C.checkerTopLeft, C.checkerTopRight, C.checkerBottomRight, C.checkerBottomLeft];
  const move = (index: number, x: number, y: number) => setMarks((current) => {
    const next = [...current] as CheckerCorners;
    next[index] = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    return next;
  });
  const pointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragging.current === null) return;
    const box = event.currentTarget.getBoundingClientRect();
    move(dragging.current, (event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
  };
  const match = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context || !size) return;
    try {
      const corners = marks.map((m) => ({ x: m.x * size.width, y: m.y * size.height })) as CheckerCorners;
      onApply(fitCheckerCalibration(samplePatches(context.getImageData(0, 0, size.width, size.height), corners)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const grid = patchCentres(marks);
  const button = 'min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]';
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--bg-scrim)] p-2 sm:p-4" onKeyDown={onKeyDown}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="v2-checker-title" data-testid="v2-colour-checker"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-4xl flex-col gap-3 overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 text-[var(--text-primary)] shadow-[var(--shadow-panel)]">
        <h2 id="v2-checker-title" className="text-base font-semibold">{C.checkerTitle}</h2>
        <p className="text-xs text-[var(--text-secondary)]">{C.checkerHelp}</p>
        <div className="relative mx-auto w-fit touch-none select-none" onPointerMove={pointer} onPointerUp={() => { dragging.current = null; }}>
          <canvas ref={canvasRef} className="block max-h-[60dvh] max-w-full" aria-hidden="true" />
          {size && grid.map((p, i) => (
            <span key={i} aria-hidden="true" className="pointer-events-none absolute h-2 w-2 -translate-x-1 -translate-y-1 rounded-full border border-white bg-black/60"
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} />
          ))}
          {size && marks.map((m, i) => (
            <button key={i} type="button" aria-label={labels[i]} data-testid={`v2-checker-mark-${i}`}
              className="absolute h-6 w-6 -translate-x-3 -translate-y-3 cursor-grab rounded-full border-2 border-white bg-black/40 shadow outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]"
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
              onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); dragging.current = i; }}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 0.02 : 0.004;
                const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
                if (d) { event.preventDefault(); move(i, m.x + d[0], m.y + d[1]); }
              }}>
              <span className="text-[0.625rem] font-bold text-white">{i + 1}</span>
            </button>
          ))}
        </div>
        {error && <p role="alert" className="text-xs">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={button} onClick={onClose}>{C.checkerCancel}</button>
          <button type="button" disabled={!size} onClick={match}
            className="min-h-10 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-4 text-xs font-semibold text-[var(--text-on-accent)] hover:bg-[var(--brand-accent-hover)] disabled:opacity-50">
            {C.checkerApply}
          </button>
        </div>
      </div>
    </div>
  );
}
