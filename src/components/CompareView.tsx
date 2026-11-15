import { ArrowLeftRight, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CullDecision, PhotoFrame } from '../core/types';
import { toggleCompareDecision } from '../core/compareDecision';
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
  onStepSide: (side: 'left' | 'right', delta: number) => void;
  onDecideFrame: (frameId: string, decision: CullDecision) => void;
  onExitCompare: () => void;
}

const control = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-sm hover:bg-white/10';

export function CompareView({
  leftFrame, rightFrame, previewProvider, needsAccess, zoomLevel, panOffset,
  onTransform, onSwapPanes, onStepSide, onDecideFrame, onExitCompare,
}: Props) {
  function photo(frame: PhotoFrame | null) {
    if (!frame) return <div className="grid h-full place-items-center text-sm text-zinc-400">No photo selected</div>;
    return <FrameImage frame={frame} previewProvider={previewProvider} needsAccess={needsAccess}
      variant="full" className="h-full w-full" imgClassName="object-contain" />;
  }

  return (
    <section aria-label="Compare photos" className="flex min-h-0 flex-1 flex-col">
      <PhotoViewport base={photo(rightFrame)} overlay={photo(leftFrame)} labels={['A', 'B']}
        zoom={zoomLevel} pan={panOffset} onTransform={onTransform} />
      <div className="flex flex-wrap items-center justify-between gap-x-2 border-t border-white/10 bg-[#14161A] px-1 sm:px-3">
        <div className="flex min-w-0 flex-1 items-center">
          <button type="button" className={control} onClick={() => onStepSide('right', -1)} aria-label="Previous photo B"><ChevronLeft className="h-4 w-4" /></button>
          <span className="truncate text-xs text-zinc-300" title={rightFrame?.filename}>B · {rightFrame?.filename ?? 'Select photo'}</span>
          <button type="button" className={control} onClick={() => onStepSide('right', 1)} aria-label="Next photo B"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <button type="button" className={control} onClick={onSwapPanes} aria-label="Swap photos A and B"><ArrowLeftRight className="h-4 w-4" /></button>
        {([['A', leftFrame], ['B', rightFrame]] as const).map(([side, frame]) => (
          frame && (side === 'A' || frame.id !== leftFrame?.id) && (
            <div key={side} role="group" aria-label={`Decisions for photo ${side}`} className="flex items-center">
              {(['keep', 'reject'] as const).map((decision) => (
                <button type="button" key={decision}
                  className={`${control} capitalize aria-pressed:bg-white/15`}
                  aria-label={`${decision} photo ${side}`}
                  aria-pressed={frame.decision === decision}
                  onClick={() => onDecideFrame(frame.id, toggleCompareDecision(frame.decision, decision))}>
                  {decision} {side}
                </button>
              ))}
            </div>
          )
        ))}
        <button type="button" className={control} onClick={onExitCompare}>Done</button>
      </div>
    </section>
  );
}
