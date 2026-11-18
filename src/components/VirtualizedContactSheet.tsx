import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Info, SlidersHorizontal, Star } from 'lucide-react';
import type { CullDecision, PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import { DecisionButtons } from './DecisionButtons';
import { isEdited } from '../core/editedState';
import { speciesShown } from '../core/autoTags';
import { FrameImage } from './FrameImage';
import { jumpTarget, type JumpRequest } from '../core/jumpNavigation';
import { openPhotoMenuFromKeyboard } from './PhotoContextMenu';

interface VirtualizedContactSheetProps {
  frames: PhotoFrame[];
  selectedFrameId: string | null;
  previewProvider: BrowserPreviewProvider;
  needsAccess: boolean;
  onSelectFrame: (frameId: string, modifiers: { shift: boolean; toggle: boolean }) => void;
  markedIds: ReadonlySet<string>;
  multiSelect: boolean;
  onInfo: (frameId: string, trigger: HTMLButtonElement | null) => void;
  /** Right-click (or the Menu key) on a photo. */
  onPhotoMenu?: (frameId: string, x: number, y: number) => void;
  onOpenLoupe: (frameId: string) => void;
  onDecideFrame: (frameId: string, decision: CullDecision) => void;
  onResetFrame: (frameId: string) => void;
}

const GAP_PX = 12;
const PADDING_PX = 16;
const FOOTER_HEIGHT = 44;
// Narrow cards stack the filename above the buttons, so the three touch-sized buttons fit.
const STACKED_FOOTER_HEIGHT = 76;

export const VirtualizedContactSheet: React.FC<VirtualizedContactSheetProps> = ({
  frames,
  selectedFrameId,
  previewProvider,
  needsAccess,
  onSelectFrame,
  markedIds,
  multiSelect,
  onInfo,
  onOpenLoupe,
  onPhotoMenu,
  onDecideFrame,
  onResetFrame,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 1120, height: 640 });
  const [scrollTop, setScrollTop] = useState(0);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [jumpFrame, setJumpFrame] = useState('');
  const [jumpCaptured, setJumpCaptured] = useState('');
  const [jumpError, setJumpError] = useState('');
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const longPressed = useRef(false);
  const touchFrame = useRef<string | null>(null);

  function cancelPress() {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  }

  useEffect(() => cancelPress, []);

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
  const stacked = columns <= 2;
  const footerHeight = stacked ? STACKED_FOOTER_HEIGHT : FOOTER_HEIGHT;
  const cardHeight = Math.round((cardWidth * 2) / 3) + footerHeight;
  const rowStride = cardHeight + GAP_PX;
  const totalRows = Math.ceil(frames.length / columns);
  const totalHeight = Math.max(0, totalRows * rowStride + PADDING_PX * 2);

  const startRow = Math.max(0, Math.floor((scrollTop - PADDING_PX) / rowStride) - 2);
  const endRow = Math.min(
    totalRows - 1,
    Math.ceil((scrollTop + viewport.height - PADDING_PX) / rowStride) + 2
  );

  /** A direct metadata jump avoids mounting and loading any intermediate rows. */
  function jumpTo(request: JumpRequest) {
    const target = jumpTarget(frames, request);
    if (!target) {
      setJumpError(request.kind === 'last-edited'
        ? 'No recorded edits in this view.'
        : request.kind === 'captured-at' ? 'No usable capture dates in this view.' : 'Frame not in this view.');
      return;
    }
    const index = frames.findIndex((frame) => frame.id === target.id);
    if (index < 0) return;
    const rowTop = PADDING_PX + Math.floor(index / columns) * rowStride;
    if (containerRef.current) containerRef.current.scrollTop = Math.max(0, rowTop - Math.round(viewport.height / 4));
    onSelectFrame(target.id, { shift: false, toggle: false });
    setJumpError('');
    setJumpOpen(false);
  }

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
      <div className="flex-1 flex flex-col items-center justify-center bg-kestrel-stage text-zinc-400 p-8 text-center">
        <p className="text-sm font-medium text-zinc-300">No frames match this filter</p>
        <p className="text-xs text-zinc-400 mt-1">
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
      className="flex-1 overflow-y-auto bg-kestrel-stage relative min-w-0 min-h-0"
    >
      <div className="sticky top-2 z-10 h-0 pointer-events-none">
        <div className="absolute right-3 top-0 pointer-events-auto">
          <button type="button" onClick={() => { setJumpOpen((value) => !value); setJumpError(''); }}
            aria-label="Jump to a photo" aria-controls="kestrel-grid-jump" aria-expanded={jumpOpen}
            className="min-h-10 rounded-lg border border-white/20 bg-kestrel-panel/95 px-3 py-2 text-xs font-medium text-zinc-100 shadow-lg hover:bg-kestrel-raised focus-visible:outline-2 focus-visible:outline-sky-300">
            Jump…
          </button>
          {jumpOpen && (
            <div id="kestrel-grid-jump" role="group" aria-label="Jump within this view"
              className="absolute right-0 top-11 w-[min(19rem,calc(100vw-2.5rem))] space-y-3 rounded-xl border border-white/20 bg-kestrel-raised p-3 shadow-2xl">
              <div className="flex gap-2">
                <button type="button" onClick={() => jumpTo({ kind: 'first' })}
                  className="min-h-10 flex-1 rounded-md border border-white/15 px-2 text-xs text-zinc-100">First</button>
                <button type="button" onClick={() => jumpTo({ kind: 'last' })}
                  className="min-h-10 flex-1 rounded-md border border-white/15 px-2 text-xs text-zinc-100">Last</button>
                <button type="button" onClick={() => jumpTo({ kind: 'last-edited' })}
                  className="min-h-10 flex-1 rounded-md border border-white/15 px-2 text-xs text-zinc-100">Last edited</button>
              </div>
              <form onSubmit={(event) => {
                event.preventDefault();
                jumpTo({ kind: 'frame', number: Number(jumpFrame) });
              }}>
                <label htmlFor="kestrel-jump-frame" className="block text-xs text-zinc-300">Frame number</label>
                <div className="mt-1 flex gap-2">
                  <input id="kestrel-jump-frame" type="number" min="1" step="1" value={jumpFrame}
                    onChange={(event) => setJumpFrame(event.target.value)} placeholder="e.g. 1695"
                    className="min-w-0 flex-1 rounded-md border border-white/15 bg-kestrel-panel px-2 py-2 text-sm text-zinc-100" />
                  <button type="submit" disabled={!jumpFrame.trim()}
                    className="min-h-10 rounded-md border border-white/15 px-3 text-xs text-zinc-100 disabled:opacity-50">Go</button>
                </div>
              </form>
              <form onSubmit={(event) => {
                event.preventDefault();
                jumpTo({ kind: 'captured-at', timestamp: jumpCaptured ? new Date(jumpCaptured).getTime() : NaN });
              }}>
                <label htmlFor="kestrel-jump-captured" className="block text-xs text-zinc-300">Nearest capture date and time</label>
                <div className="mt-1 flex gap-2">
                  <input id="kestrel-jump-captured" type="datetime-local" value={jumpCaptured}
                    onChange={(event) => setJumpCaptured(event.target.value)}
                    className="min-w-0 flex-1 rounded-md border border-white/15 bg-kestrel-panel px-2 py-2 text-xs text-zinc-100" />
                  <button type="submit" disabled={!jumpCaptured}
                    className="min-h-10 rounded-md border border-white/15 px-3 text-xs text-zinc-100 disabled:opacity-50">Go</button>
                </div>
              </form>
              {jumpError && <p role="status" className="text-xs text-orange-200">{jumpError}</p>}
              <p className="text-[11px] text-zinc-400">Only photos matching your current filter are included. No intervening thumbnails are loaded.</p>
            </div>
          )}
        </div>
      </div>
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
                const isMarked = markedIds.has(frame.id);
                const isSelected = multiSelect ? isMarked : frame.id === selectedFrameId;
                const isKeep = frame.decision === 'keep';
                const isReject = frame.decision === 'reject';

                return (
                  <div
                    key={frame.id}
                    role="article"
                    aria-label={`Frame ${frame.filename}`}
                    onContextMenu={(event) => {
                      if (event.defaultPrevented) return;
                      event.preventDefault();
                      onInfo(frame.id, event.currentTarget.querySelector('[data-info-button]'));
                    }}
                    className={`relative flex flex-col rounded-lg border overflow-hidden motion-safe:transition-colors ${
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
                      onPointerDown={(event) => {
                        longPressed.current = false;
                        touchFrame.current = event.pointerType === 'touch' ? frame.id : null;
                        if (event.pointerType !== 'touch') return;
                        cancelPress();
                        const card = event.currentTarget.parentElement;
                        press.current = { x: event.clientX, y: event.clientY, timer: window.setTimeout(() => {
                          longPressed.current = true;
                          onInfo(frame.id, card?.querySelector('[data-info-button]') ?? null);
                        }, 500) };
                      }}
                      onPointerMove={(event) => {
                        if (press.current && Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > 10) {
                          cancelPress();
                          touchFrame.current = null;
                        }
                      }}
                      onPointerCancel={() => {
                        cancelPress();
                        touchFrame.current = null;
                      }}
                      onPointerUp={cancelPress}
                      onClick={(event) => {
                        const tapped = event.detail > 0 && touchFrame.current === frame.id;
                        const held = longPressed.current;
                        touchFrame.current = null;
                        longPressed.current = false;
                        if (held) return;

                        const modifiers = { shift: event.shiftKey, toggle: event.ctrlKey || event.metaKey };
                        if (tapped && !multiSelect && !modifiers.shift && !modifiers.toggle) onOpenLoupe(frame.id);
                        else onSelectFrame(frame.id, modifiers);
                      }}
                      onKeyDown={(event) => {
                        if (onPhotoMenu && openPhotoMenuFromKeyboard(event, (x, y) => onPhotoMenu(frame.id, x, y))) return;
                        if (event.key !== 'Enter' || multiSelect || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
                        event.preventDefault();
                        if (!event.repeat) onOpenLoupe(frame.id);
                      }}
                      onDoubleClick={(event) => {
                        if (!multiSelect && !event.shiftKey && !event.ctrlKey && !event.metaKey) onOpenLoupe(frame.id);
                      }}
                      onContextMenu={(event) => { if (!onPhotoMenu) return; event.preventDefault(); onPhotoMenu(frame.id, event.clientX, event.clientY); }}
                      aria-haspopup={onPhotoMenu ? "menu" : undefined}
                      aria-keyshortcuts={onPhotoMenu ? "Shift+F10 ContextMenu" : undefined}
                      aria-pressed={isSelected}
                      aria-label={`${multiSelect ? 'Select' : 'View'} ${frame.filename}`} title={`${multiSelect ? 'Select' : 'View'} ${frame.filename}`}
                      className="relative flex-1 w-full overflow-hidden focus-visible:outline-2 focus-visible:outline-sky-400 text-left"
                    >
                      <FrameImage
                        frame={frame}
                        previewProvider={previewProvider}
                        variant="thumb"
                        priority={isSelected}
                        needsAccess={needsAccess}
                        className="w-full h-full"
                        imgClassName="object-cover"
                      />
                      {(() => {
                        const species = speciesShown(frame);
                        return species ? (
                          <span data-testid="species-label" className="absolute inset-x-0 bottom-0 flex items-center gap-1 truncate bg-black/65 px-2 py-1 text-xs text-zinc-100">
                            <span className="truncate">Species: {species.name}</span>
                            {species.auto && <span className="shrink-0 rounded bg-sky-300/25 px-1 text-[10px] font-medium uppercase tracking-wide text-sky-100" title="Named automatically. Open the photo info to keep or change it.">Auto</span>}
                          </span>
                        ) : null;
                      })()}
                      {isEdited(frame) && (
                        <span role="img" aria-label="Edited" title="Edited"
                          className={`absolute left-1.5 ${speciesShown(frame) ? 'bottom-8' : 'bottom-1.5'} grid h-6 w-6 place-items-center rounded-full border border-white/20 bg-kestrel-canvas/85 text-sky-200`}>
                          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                      )}

                      {/* Burst Group Indicator Strip */}
                      {frame.burstGroupId && (
                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-kestrel-canvas/80 text-[10px] font-mono tabular-nums text-zinc-200 border border-white/10">
                          Burst {frame.burstIndex}/
                          {frame.burstCount}
                        </div>
                      )}
                    </button>

                    <button type="button" data-info-button onClick={(event) => onInfo(frame.id, event.currentTarget)}
                      aria-label={`Photo info and rating for ${frame.filename}`} title={`Photo info and rating for ${frame.filename}`}
                      className="absolute top-0 right-0 grid h-11 w-11 place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-sky-300">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-black/75"><Info className="h-4 w-4" aria-hidden="true" /></span>
                    </button>

                    {/* Card Footer: Number, Filename & Colorblind-safe Decision Control */}
                    <div style={{ height: footerHeight }} className={`shrink-0 border-t border-white/6 ${stacked ? 'flex flex-col justify-center gap-1 px-1.5' : 'flex items-center justify-between gap-2 px-2.5'}`}>
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium text-zinc-200 truncate">
                          {frame.filename}
                          <span className="sr-only">, {frame.decision === 'keep' ? 'Keeper' : frame.decision === 'reject' ? 'In Trash' : 'To review'}</span>
                        </div>
                        <div className="text-[10px] font-mono tabular-nums text-zinc-500">
                          #{String(frame.sequenceIndex).padStart(4, '0')}
                          {Boolean(frame.rating ?? frame.exif.rating) && <span className="ml-1 inline-flex items-center gap-0.5 text-zinc-300">
                            <Star className="h-2.5 w-2.5" aria-hidden="true" />{frame.rating ?? frame.exif.rating}</span>}
                        </div>
                      </div>

                      <DecisionButtons stretch={stacked} decision={frame.decision} filename={frame.filename} edited={isEdited(frame)}
                        onKeep={() => onDecideFrame(frame.id, 'keep')}
                        onBackToReview={() => onDecideFrame(frame.id, 'unreviewed')}
                        onTrash={() => onDecideFrame(frame.id, 'reject')}
                        onReset={() => onResetFrame(frame.id)} />
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
