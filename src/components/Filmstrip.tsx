import React, { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import { FrameImage } from './FrameImage';

interface FilmstripProps {
  frames: PhotoFrame[];
  selectedFrameId: string | null;
  compareRightFrameId?: string | null;
  isCompareMode?: boolean;
  previewProvider: BrowserPreviewProvider;
  needsAccess: boolean;
  onSelectFrame: (frameId: string) => void;
  onSelectCompareRight?: (frameId: string) => void;
}

const ITEM_WIDTH = 108;
const ITEM_GAP = 8;
const STRIDE = ITEM_WIDTH + ITEM_GAP;
const PADDING_X = 16;

export const Filmstrip: React.FC<FilmstripProps> = ({
  frames,
  selectedFrameId,
  compareRightFrameId,
  isCompareMode = false,
  previewProvider,
  needsAccess,
  onSelectFrame,
  onSelectCompareRight,
}) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(1100);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => setViewportWidth(el.clientWidth || 1100);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep active frame centered smoothly when navigating
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !selectedFrameId) return;
    const idx = frames.findIndex((f) => f.id === selectedFrameId);
    if (idx === -1) return;

    const itemLeft = PADDING_X + idx * STRIDE;
    const itemRight = itemLeft + ITEM_WIDTH;
    if (itemLeft < el.scrollLeft + 48) {
      el.scrollLeft = Math.max(0, itemLeft - viewportWidth * 0.25);
    } else if (itemRight > el.scrollLeft + viewportWidth - 48) {
      el.scrollLeft = itemRight - viewportWidth * 0.75;
    }
  }, [selectedFrameId, frames, viewportWidth]);

  const totalWidth = Math.max(0, frames.length * STRIDE + PADDING_X * 2);
  const startIdx = Math.max(0, Math.floor((scrollLeft - PADDING_X) / STRIDE) - 4);
  const endIdx = Math.min(
    frames.length - 1,
    Math.ceil((scrollLeft + viewportWidth - PADDING_X) / STRIDE) + 4
  );

  const visibleIndices: number[] = [];
  for (let i = startIdx; i <= endIdx; i += 1) {
    visibleIndices.push(i);
  }

  return (
    <div
      ref={scrollerRef}
      onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
      aria-label="Shoot filmstrip"
      className="h-[80px] sm:h-[112px] shrink-0 bg-[#121418] border-t border-white/10 overflow-x-auto overflow-y-hidden relative select-none"
    >
      <div style={{ width: totalWidth, height: '100%', position: 'relative' }}>
        {visibleIndices.map((idx) => {
          const frame = frames[idx];
          const isLeftActive = frame.id === selectedFrameId;
          const isRightActive = isCompareMode && frame.id === compareRightFrameId;
          const left = PADDING_X + idx * STRIDE;

          const prevFrame = idx > 0 ? frames[idx - 1] : null;
          const sameBurstAsPrev =
            Boolean(frame.burstGroupId) && prevFrame?.burstGroupId === frame.burstGroupId;
          const nextFrame = idx < frames.length - 1 ? frames[idx + 1] : null;
          const sameBurstAsNext =
            Boolean(frame.burstGroupId) && nextFrame?.burstGroupId === frame.burstGroupId;

          return (
            <div
              key={frame.id}
              style={{
                position: 'absolute',
                left,
                top: 8,
                width: ITEM_WIDTH,
              }}
              className="flex h-[60px] flex-col sm:h-[92px]"
            >
              {/* Burst Group Connector Line */}
              <div className="h-2.5 flex items-center relative mb-1">
                {frame.burstGroupId && (
                  <div
                    className={`h-[2px] bg-zinc-500/70 w-full ${
                      !sameBurstAsPrev ? 'rounded-l ml-1' : ''
                    } ${!sameBurstAsNext ? 'rounded-r mr-1' : ''}`}
                    title={`Burst ${frame.burstGroupId.replace('burst-', '')} (${frame.burstIndex}/${frame.burstCount})`}
                  />
                )}
              </div>

              <button
                type="button"
                onClick={(e) => {
                  if (isCompareMode && e.shiftKey && onSelectCompareRight) {
                    onSelectCompareRight(frame.id);
                  } else {
                    onSelectFrame(frame.id);
                  }
                }}
                aria-label={`Jump to frame ${frame.filename}`}
                className={`relative flex-1 rounded overflow-hidden border transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
                  isLeftActive
                    ? 'border-sky-400 ring-2 ring-sky-400/50'
                    : isRightActive
                    ? 'border-amber-300 ring-2 ring-amber-300/40'
                    : frame.decision === 'keep'
                    ? 'border-sky-400/45'
                    : frame.decision === 'reject'
                    ? 'border-orange-400/40 opacity-60'
                    : 'border-white/10 hover:border-white/30'
                }`}
              >
                <FrameImage
                  frame={frame}
                  previewProvider={previewProvider}
                  variant="thumb"
                  needsAccess={needsAccess}
                  className="w-full h-full"
                  imgClassName="object-cover"
                />

                {/* Frame index */}
                <span className="absolute bottom-1 left-1 px-1 py-0.2 rounded bg-kestrel-canvas/80 text-[10px] font-mono tabular-nums text-zinc-200">
                  {frame.sequenceIndex}
                </span>

                {/* Decision badge */}
                {frame.decision === 'keep' && (
                  <span
                    aria-label="Keep"
                    className="absolute top-1 right-1 w-4 h-4 rounded bg-sky-500 text-zinc-950 flex items-center justify-center"
                  >
                    <Check className="w-3 h-3 stroke-[2.5]" aria-hidden="true" />
                  </span>
                )}
                {frame.decision === 'reject' && (
                  <span
                    aria-label="Reject"
                    className="absolute top-1 right-1 w-4 h-4 rounded bg-orange-500 text-zinc-950 flex items-center justify-center"
                  >
                    <X className="w-3 h-3 stroke-[2.5]" aria-hidden="true" />
                  </span>
                )}

                {isCompareMode && (isLeftActive || isRightActive) && (
                  <span className="absolute top-1 left-1 px-1 rounded bg-kestrel-canvas/85 text-[9px] font-mono font-semibold text-zinc-100 border border-white/15">
                    {isLeftActive ? 'A' : 'B'}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
