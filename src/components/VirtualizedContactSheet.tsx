import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleDashed, X } from 'lucide-react';
import type { CullDecision, PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import { FrameImage } from './FrameImage';

interface VirtualizedContactSheetProps {
  frames: PhotoFrame[];
  selectedFrameId: string | null;
  previewProvider: BrowserPreviewProvider;
  needsAccess: boolean;
  onSelectFrame: (frameId: string) => void;
  onOpenLoupe: (frameId: string) => void;
  onDecideFrame: (frameId: string, decision: CullDecision) => void;
}

const GAP_PX = 12;
const PADDING_PX = 16;
const FOOTER_HEIGHT = 44;

export const VirtualizedContactSheet: React.FC<VirtualizedContactSheetProps> = ({
  frames,
  selectedFrameId,
  previewProvider,
  needsAccess,
  onSelectFrame,
  onOpenLoupe,
  onDecideFrame,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 1120, height: 640 });
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      setViewport({
        width: el.clientWidth || 1120,
        height: el.clientHeight || 640,
      });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columns = useMemo(() => {
    if (viewport.width >= 1280) return 5;
    if (viewport.width >= 960) return 4;
    if (viewport.width >= 640) return 3;
    return 2;
  }, [viewport.width]);

  const cardWidth = useMemo(() => {
    const usable = Math.max(240, viewport.width - PADDING_PX * 2 - GAP_PX * (columns - 1));
    return Math.floor(usable / columns);
  }, [viewport.width, columns]);

  // 3:2 thumbnail + footer height
  const cardHeight = Math.round((cardWidth * 2) / 3) + FOOTER_HEIGHT;
  const rowStride = cardHeight + GAP_PX;
  const totalRows = Math.ceil(frames.length / columns);
  const totalHeight = Math.max(0, totalRows * rowStride + PADDING_PX * 2);

  const startRow = Math.max(0, Math.floor((scrollTop - PADDING_PX) / rowStride) - 2);
  const endRow = Math.min(
    totalRows - 1,
    Math.ceil((scrollTop + viewport.height - PADDING_PX) / rowStride) + 2
  );

  // Scroll selected card into view when navigating via keyboard inside grid
  useEffect(() => {
    if (!selectedFrameId || !containerRef.current) return;
    const idx = frames.findIndex((f) => f.id === selectedFrameId);
    if (idx === -1) return;
    const row = Math.floor(idx / columns);
    const rowTop = PADDING_PX + row * rowStride;
    const rowBottom = rowTop + cardHeight;
    const el = containerRef.current;
    if (rowTop < el.scrollTop) {
      el.scrollTop = Math.max(0, rowTop - PADDING_PX);
    } else if (rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = rowBottom - el.clientHeight + PADDING_PX;
    }
  }, [selectedFrameId, frames, columns, rowStride, cardHeight]);

  if (frames.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0D0E11] text-zinc-400 p-8 text-center">
        <p className="text-sm font-medium text-zinc-300">No frames match this filter</p>
        <p className="text-xs text-zinc-500 mt-1">
          Clear the search or pick All to see the full contact sheet.
        </p>
      </div>
    );
  }

  const visibleRows: number[] = [];
  for (let r = startRow; r <= endRow; r += 1) {
    visibleRows.push(r);
  }

  return (
    <div
      ref={containerRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      data-testid="virtualized-contact-sheet"
      className="flex-1 overflow-y-auto bg-[#0D0E11] relative min-w-0 min-h-0"
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visibleRows.map((rowIndex) => {
          const rowStartIdx = rowIndex * columns;
          const rowFrames = frames.slice(rowStartIdx, rowStartIdx + columns);
          const top = PADDING_PX + rowIndex * rowStride;

          return (
            <div
              key={rowIndex}
              style={{
                position: 'absolute',
                top,
                left: PADDING_PX,
                right: PADDING_PX,
                height: cardHeight,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: `${GAP_PX}px`,
              }}
            >
              {rowFrames.map((frame) => {
                const isSelected = frame.id === selectedFrameId;
                const isKeep = frame.decision === 'keep';
                const isReject = frame.decision === 'reject';

                return (
                  <div
                    key={frame.id}
                    role="article"
                    aria-label={`Frame ${frame.filename}`}
                    className={`flex flex-col rounded-lg border overflow-hidden transition-colors ${
                      isSelected
                        ? 'border-sky-400 bg-[#1B1F27] ring-1 ring-sky-400/50'
                        : isKeep
                        ? 'border-sky-400/40 bg-[#15181E] hover:border-sky-400/70'
                        : isReject
                        ? 'border-orange-400/35 bg-[#15161A] opacity-75 hover:opacity-100'
                        : 'border-white/8 bg-[#15171C] hover:border-white/25'
                    }`}
                  >
                    {/* Clickable Thumbnail */}
                    <button
                      type="button"
                      onClick={() => onSelectFrame(frame.id)}
                      onDoubleClick={() => onOpenLoupe(frame.id)}
                      aria-label={`Select ${frame.filename}`}
                      className="relative flex-1 w-full overflow-hidden focus-visible:outline-2 focus-visible:outline-sky-400 text-left"
                    >
                      <FrameImage
                        frame={frame}
                        previewProvider={previewProvider}
                        variant="thumb"
                        needsAccess={needsAccess}
                        className="w-full h-full"
                        imgClassName="object-cover"
                      />

                      {/* Burst Group Indicator Strip */}
                      {frame.burstGroupId && (
                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-[#101114]/80 text-[10px] font-mono tabular-nums text-zinc-200 border border-white/10">
                          B{frame.burstGroupId.replace('burst-', '')} · {frame.burstIndex}/
                          {frame.burstCount}
                        </div>
                      )}
                    </button>

                    {/* Card Footer: Number, Filename & Colorblind-safe Decision Control */}
                    <div className="h-[44px] shrink-0 px-2.5 flex items-center justify-between gap-2 border-t border-white/6">
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium text-zinc-200 truncate">
                          {frame.filename}
                        </div>
                        <div className="text-[10px] font-mono tabular-nums text-zinc-500">
                          #{String(frame.sequenceIndex).padStart(4, '0')}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDecideFrame(frame.id, isKeep ? 'unreviewed' : 'keep');
                          }}
                          aria-label={`Keep ${frame.filename}`}
                          aria-pressed={isKeep}
                          className={`px-1.5 py-1 rounded text-[11px] font-medium border flex items-center gap-1 transition-colors ${
                            isKeep
                              ? 'bg-sky-500/20 border-sky-400/60 text-sky-200'
                              : 'bg-white/4 border-white/10 text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          <Check className="w-3 h-3" aria-hidden="true" />
                          {isKeep && <span>Keep</span>}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDecideFrame(frame.id, isReject ? 'unreviewed' : 'reject');
                          }}
                          aria-label={`Reject ${frame.filename}`}
                          aria-pressed={isReject}
                          className={`px-1.5 py-1 rounded text-[11px] font-medium border flex items-center gap-1 transition-colors ${
                            isReject
                              ? 'bg-orange-500/20 border-orange-400/60 text-orange-200'
                              : 'bg-white/4 border-white/10 text-zinc-400 hover:text-zinc-200'
                          }`}
                        >
                          <X className="w-3 h-3" aria-hidden="true" />
                          {isReject && <span>Reject</span>}
                        </button>
                        {!isKeep && !isReject && (
                          <span className="sr-only">
                            <CircleDashed className="w-3 h-3" /> Unreviewed
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
