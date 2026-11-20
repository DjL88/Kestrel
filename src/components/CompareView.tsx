import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Maximize2, ZoomIn } from 'lucide-react';
import type { CullDecision, PhotoFrame } from '../core/types';
import { toggleCompareDecision } from '../core/compareDecision';
import { resolveCompareKey } from '../core/compareKeyboard';
import { compareNavigation, compareQueueState } from '../core/compareNavigation';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import { FrameImage } from './FrameImage';
import { PhotoViewport } from './PhotoViewport';
import { maxZoomFor } from '../core/zoomControls';
import { comparePreviewPixelZoom } from '../core/compareZoom';
import { viewerText as t } from '../i18n/areas/viewer';

interface Props {
  leftFrame: PhotoFrame | null;
  rightFrame: PhotoFrame | null;
  previewProvider: BrowserPreviewProvider;
  needsAccess: boolean;
  zoomLevel: number;
  panOffset: { x: number; y: number };
  onTransform: (zoom: number, pan: { x: number; y: number }) => void;
  onSwapPanes: () => void;
  candidates: readonly PhotoFrame[];
  onSelectRight: (frameId: string) => void;
  onDecideFrame: (frameId: string, decision: CullDecision) => void;
  onExitCompare: () => void;
}

const control = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-sm hover:bg-white/10';

export function CompareView({
  leftFrame, rightFrame, previewProvider, needsAccess, zoomLevel, panOffset,
  onTransform, onSwapPanes, candidates, onSelectRight, onDecideFrame, onExitCompare,
}: Props) {
  const surfaceRef = useRef<HTMLElement>(null);
  const photoStageRef = useRef<HTMLDivElement>(null);
  const [previewFit, setPreviewFit] = useState(0);
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const { previous, next, currentValid, referenceValid } = compareNavigation(candidates, leftFrame?.id ?? null, rightFrame?.id ?? null);
  const uniqueRight = !!rightFrame && !!leftFrame && referenceValid && rightFrame.id !== leftFrame.id && currentValid;
  const queue = compareQueueState(candidates, leftFrame?.id ?? null, rightFrame?.id ?? null);
  const canGoBack = previous !== null;
  const canGoForward = next !== null;
  // The zoom control is based on photo B's *loaded preview*, not 2× Fit.
  // Never label a reduced RAW preview as full-resolution sensor pixels.
  useEffect(() => {
    const stage = photoStageRef.current;
    if (!stage) return;
    const measure = () => {
      const img = stage.querySelector<HTMLImageElement>('[data-compare-main] img');
      const bounds = stage.getBoundingClientRect();
      setPreviewFit(img?.complete && img.naturalWidth > 0 && img.naturalHeight > 0 && bounds.width > 0 && bounds.height > 0
        ? Math.min(bounds.width / img.naturalWidth, bounds.height / img.naturalHeight) : 0);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(stage);
    return () => observer?.disconnect();
  }, [rightFrame?.id, uniqueRight]);
  const maxZoom = maxZoomFor(previewFit, dpr);
  const actual200 = comparePreviewPixelZoom(previewFit, dpr);

  // Clicking a photograph makes the comparison keyboard-ready without requiring
  // the photographer to find a tiny focus target. Never steal focus from a
  // toolbar, zoom control, wipe handle, link or input.
  function focusPhotoSurface(event: PointerEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest('button, input, textarea, select, a, [role="slider"], [contenteditable="true"]')) return;
    surfaceRef.current?.focus({ preventScroll: true });
  }

  function handleCompareKey(event: KeyboardEvent<HTMLElement>) {
    // The section is the only valid shortcut target. Descendant toolbar
    // controls retain native keyboard behaviour and app-level commands.
    if (event.target !== event.currentTarget) return;
    const action = resolveCompareKey(event.nativeEvent, uniqueRight ? rightFrame?.decision ?? null : null, canGoBack, canGoForward);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action.kind === 'previous' && previous) onSelectRight(previous);
    else if (action.kind === 'next' && next) onSelectRight(next);
    else if (action.kind === 'decision' && rightFrame && uniqueRight) onDecideFrame(rightFrame.id, action.decision);
  }

  function photo(frame: PhotoFrame | null) {
    if (!frame) return <div className="grid h-full place-items-center text-sm text-zinc-400">{t.compare.noPhotoSelected}</div>;
    return <FrameImage frame={frame} previewProvider={previewProvider} needsAccess={needsAccess}
      variant="full" className="h-full w-full" imgClassName="object-contain" />;
  }

  return (
    <section ref={surfaceRef} onPointerDownCapture={focusPhotoSurface} aria-label={t.compare.region} aria-description={t.compare.regionHelp} tabIndex={0} onKeyDown={handleCompareKey} className="flex min-h-0 flex-1 flex-col focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-300">
      {!referenceValid && <p role="status" className="px-3 py-2 text-sm text-amber-200">{t.compare.referenceGone}</p>}
      {queue.state === 'unselected' && <div role="status" className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm text-zinc-300"><span>{t.compare.chooseB}</span><button type="button" className={control} disabled={!queue.recoveryId} onClick={() => queue.recoveryId && onSelectRight(queue.recoveryId)}>{t.compare.chooseFirstB}</button></div>}
      {queue.state === 'missing-comparison' && <div role="status" className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm text-amber-200">
        <span>{t.compare.missingB}</span>
        {queue.recoveryId && <button type="button" className={control} onClick={() => queue.recoveryId && onSelectRight(queue.recoveryId)}>{t.compare.chooseAvailableB}</button>}
      </div>}
      {queue.state === 'empty' && <p role="status" className="px-3 py-2 text-sm text-zinc-300">{t.compare.noOtherPhotos}</p>}
      <div ref={photoStageRef} className="flex min-h-0 flex-1" onLoadCapture={() => {
        const stage = photoStageRef.current;
        const img = stage?.querySelector<HTMLImageElement>('[data-compare-main] img');
        const bounds = stage?.getBoundingClientRect();
        if (img && bounds?.width && bounds.height && img.naturalWidth > 0 && img.naturalHeight > 0) {
          setPreviewFit(Math.min(bounds.width / img.naturalWidth, bounds.height / img.naturalHeight));
        }
      }}>
        <PhotoViewport base={<div data-compare-main className="h-full w-full">{photo(uniqueRight ? rightFrame : null)}</div>}
          overlay={photo(referenceValid ? leftFrame : null)} labels={['A', 'B']}
          zoom={zoomLevel} pan={panOffset} maxZoom={maxZoom} onTransform={onTransform} />
      </div>
      <div role="toolbar" aria-label={t.compare.toolbar} className="flex flex-wrap items-center justify-between gap-x-2 border-t border-white/10 bg-kestrel-panel px-1 sm:px-3">
        <div role="group" aria-label={t.compare.zoomGroup} className="flex items-center">
          <button type="button" className={control} onClick={() => onTransform(1, { x: 0, y: 0 })}
            aria-label={t.compare.fitBoth} title={t.compare.fitBoth} aria-pressed={zoomLevel === 1}>
            <Maximize2 aria-hidden="true" className="h-4 w-4" /><span className="ml-1 text-xs">{t.compare.fit}</span>
          </button>
          <button type="button" className={control} disabled={actual200 === null}
            onClick={() => actual200 !== null && onTransform(actual200, { x: 0, y: 0 })}
            aria-label={actual200 === null ? t.compare.previewZoomNotReady : t.compare.actualPreview200}
            title={actual200 === null ? t.compare.previewZoomNotReady : t.compare.actualPreview200}
            aria-pressed={actual200 !== null && Math.abs(zoomLevel - actual200) < 0.001}>
            <ZoomIn aria-hidden="true" className="h-4 w-4" /><span className="ml-1 text-xs">{t.compare.twoHundred}</span>
          </button>
        </div>
        <div className="flex w-full min-w-0 items-center sm:w-auto sm:flex-1">
          <span data-testid="compare-photo-a" className="min-w-0 flex-1 truncate px-2 text-xs text-zinc-300" title={referenceValid ? leftFrame?.filename : t.compare.referenceUnavailable}>
            A · {referenceValid ? leftFrame?.filename : 'Reference unavailable'}
          </span>
          <button type="button" className={`${control} disabled:opacity-35`} disabled={!canGoBack} onClick={() => previous && onSelectRight(previous)} aria-label={t.compare.previousB} title={t.compare.previousB}><ChevronLeft className="h-4 w-4" /></button>
          <span data-testid="compare-photo-b" className="min-w-0 flex-1 truncate text-xs text-zinc-300" title={uniqueRight ? rightFrame?.filename : undefined}>B · {uniqueRight ? rightFrame?.filename : t.compare.selectPhoto} <span className="text-zinc-400">{queue.state === 'ready' ? `(${t.compare.position(queue.position, queue.total)})` : `(${t.compare.position(0, queue.total)})`}</span></span>
          <button type="button" className={`${control} disabled:opacity-35`} disabled={!canGoForward} onClick={() => next && onSelectRight(next)} aria-label={t.compare.nextB} title={t.compare.nextB}><ChevronRight className="h-4 w-4" /></button>
        </div>
        <button type="button" className={control} disabled={!uniqueRight} onClick={onSwapPanes} aria-label={t.compare.swap} title={t.compare.swap}><ArrowLeftRight className="h-4 w-4" /></button>
        {([['A', leftFrame], ['B', rightFrame]] as const).map(([side, frame]) => (
          frame && (side === 'A' ? referenceValid : uniqueRight) && (
            <div key={side} role="group" aria-label={t.compare.decisionsFor(side)} className="flex items-center">
              {(['keep', 'reject'] as const).map((decision) => (
                <button type="button" key={decision}
                  className={`${control} capitalize aria-pressed:bg-white/15 aria-pressed:font-semibold`}
                  aria-label={decision === "keep" ? t.compare.keepPhoto(side) : t.compare.rejectPhoto(side)} title={decision === "keep" ? t.compare.keepPhoto(side) : t.compare.rejectPhoto(side)}
                  aria-pressed={frame.decision === decision}
                  onClick={() => onDecideFrame(frame.id, toggleCompareDecision(frame.decision, decision))}>
                  {frame.decision === decision && <span aria-hidden="true">✓ </span>}{decision === "keep" ? t.compare.keepSide(side) : t.compare.rejectSide(side)}
                </button>
              ))}
              <button type="button" className={control} disabled={frame.decision === 'unreviewed'}
                aria-label={t.compare.clearDecisionFor(side)}
                title={t.compare.clearDecisionFor(side)}
                onClick={() => onDecideFrame(frame.id, 'unreviewed')}>
                {t.compare.clearSide(side)}
              </button>
            </div>
          )
        ))}
        <button type="button" className={control} onClick={onExitCompare} aria-label={t.compare.finish}>{t.compare.done}</button>
      </div>
    </section>
  );
}
