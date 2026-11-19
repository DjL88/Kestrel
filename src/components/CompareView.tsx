import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Maximize2, ZoomIn } from 'lucide-react';
import type { CullDecision, PhotoFrame } from '../core/types';
import { toggleCompareDecision } from '../core/compareDecision';
import { resolveCompareKey } from '../core/compareKeyboard';
import { compareNavigation, compareQueueState } from '../core/compareNavigation';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import { FrameImage } from './FrameImage';
import { PhotoViewport } from './PhotoViewport';

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
  const { previous, next, currentValid, referenceValid } = compareNavigation(candidates, leftFrame?.id ?? null, rightFrame?.id ?? null);
  const uniqueRight = !!rightFrame && !!leftFrame && referenceValid && rightFrame.id !== leftFrame.id && currentValid;
  const queue = compareQueueState(candidates, leftFrame?.id ?? null, rightFrame?.id ?? null);
  const canGoBack = previous !== null;
  const canGoForward = next !== null;

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
    if (!frame) return <div className="grid h-full place-items-center text-sm text-zinc-400">No photo selected</div>;
    return <FrameImage frame={frame} previewProvider={previewProvider} needsAccess={needsAccess}
      variant="full" className="h-full w-full" imgClassName="object-contain" />;
  }

  return (
    <section ref={surfaceRef} onPointerDownCapture={focusPhotoSurface} aria-label="Compare photos" aria-description="Click a photo to focus this comparison. Left and Right select photo B. K keeps B, X rejects B, U clears B. Tab moves through controls." tabIndex={0} onKeyDown={handleCompareKey} className="flex min-h-0 flex-1 flex-col focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-300">
      {!referenceValid && <p role="status" className="px-3 py-2 text-sm text-amber-200">Reference photo A is no longer in this review. Return to Review and select a new reference before comparing or making decisions.</p>}
      {queue.state === 'unselected' && <div role="status" className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm text-zinc-300"><span>Choose a photo B to begin comparing.</span><button type="button" className={control} disabled={!queue.recoveryId} onClick={() => queue.recoveryId && onSelectRight(queue.recoveryId)}>Select first photo B</button></div>}
      {queue.state === 'missing-comparison' && <div role="status" className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm text-amber-200">
        <span>Photo B is no longer in this review. No decision can be made until another photo is selected.</span>
        {queue.recoveryId && <button type="button" className={control} onClick={() => queue.recoveryId && onSelectRight(queue.recoveryId)}>Select first available photo B</button>}
      </div>}
      {queue.state === 'empty' && <p role="status" className="px-3 py-2 text-sm text-zinc-300">No other photos match this review. Change your filter or finish comparing.</p>}
      <PhotoViewport base={photo(uniqueRight ? rightFrame : null)} overlay={photo(referenceValid ? leftFrame : null)} labels={['A', 'B']}
        zoom={zoomLevel} pan={panOffset} onTransform={onTransform} />
      <div role="toolbar" aria-label="Compare photo controls" className="flex flex-wrap items-center justify-between gap-x-2 border-t border-white/10 bg-kestrel-panel px-1 sm:px-3">
        <div role="group" aria-label="Compare zoom" className="flex items-center">
          <button type="button" className={control} onClick={() => onTransform(1, { x: 0, y: 0 })}
            aria-label="Fit both photos" title="Fit both photos" aria-pressed={zoomLevel === 1}>
            <Maximize2 aria-hidden="true" className="h-4 w-4" /><span className="ml-1 text-xs">Fit</span>
          </button>
          <button type="button" className={control} onClick={() => onTransform(2, { x: 0, y: 0 })}
            aria-label="Zoom both photos to twice fitted size" title="Zoom both photos to twice fitted size"
            aria-pressed={zoomLevel === 2}>
            <ZoomIn aria-hidden="true" className="h-4 w-4" /><span className="ml-1 text-xs">2×</span>
          </button>
        </div>
        <div className="flex w-full min-w-0 items-center sm:w-auto sm:flex-1">
          <span data-testid="compare-photo-a" className="min-w-0 flex-1 truncate px-2 text-xs text-zinc-300" title={referenceValid ? leftFrame?.filename : 'Reference unavailable'}>
            A · {referenceValid ? leftFrame?.filename : 'Reference unavailable'}
          </span>
          <button type="button" className={`${control} disabled:opacity-35`} disabled={!canGoBack} onClick={() => previous && onSelectRight(previous)} aria-label="Previous photo B" title="Previous photo B"><ChevronLeft className="h-4 w-4" /></button>
          <span data-testid="compare-photo-b" className="min-w-0 flex-1 truncate text-xs text-zinc-300" title={uniqueRight ? rightFrame?.filename : undefined}>B · {uniqueRight ? rightFrame?.filename : 'Select photo'} <span className="text-zinc-400">{queue.state === 'ready' ? `(${queue.position} of ${queue.total})` : `(0 of ${queue.total})`}</span></span>
          <button type="button" className={`${control} disabled:opacity-35`} disabled={!canGoForward} onClick={() => next && onSelectRight(next)} aria-label="Next photo B" title="Next photo B"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <button type="button" className={control} disabled={!uniqueRight} onClick={onSwapPanes} aria-label="Swap photos A and B" title="Swap photos A and B"><ArrowLeftRight className="h-4 w-4" /></button>
        {([['A', leftFrame], ['B', rightFrame]] as const).map(([side, frame]) => (
          frame && (side === 'A' ? referenceValid : uniqueRight) && (
            <div key={side} role="group" aria-label={`Decisions for photo ${side}`} className="flex items-center">
              {(['keep', 'reject'] as const).map((decision) => (
                <button type="button" key={decision}
                  className={`${control} capitalize aria-pressed:bg-white/15 aria-pressed:font-semibold`}
                  aria-label={`${decision} photo ${side}`} title={`${decision} photo ${side}`}
                  aria-pressed={frame.decision === decision}
                  onClick={() => onDecideFrame(frame.id, toggleCompareDecision(frame.decision, decision))}>
                  {frame.decision === decision && <span aria-hidden="true">✓ </span>}{decision} {side}
                </button>
              ))}
              <button type="button" className={control} disabled={frame.decision === 'unreviewed'}
                aria-label={`Clear decision for photo ${side}`}
                title={`Clear decision for photo ${side}`}
                onClick={() => onDecideFrame(frame.id, 'unreviewed')}>
                Clear {side}
              </button>
            </div>
          )
        ))}
        <button type="button" className={control} onClick={onExitCompare} aria-label="Finish comparing photos">Done</button>
      </div>
    </section>
  );
}
