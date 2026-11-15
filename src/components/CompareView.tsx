import React, { useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Link2,
  Link2Off,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { CullDecision, PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import { FrameImage } from './FrameImage';

interface CompareViewProps {
  leftFrame: PhotoFrame | null;
  rightFrame: PhotoFrame | null;
  previewProvider: BrowserPreviewProvider;
  needsAccess: boolean;
  zoomLevel: number;
  onZoomChange: (next: number) => void;
  panOffset: { x: number; y: number };
  onPanChange: (next: { x: number; y: number }) => void;
  matchedZoom: boolean;
  onToggleMatchedZoom: () => void;
  onSwapPanes: () => void;
  onStepSide: (side: 'left' | 'right', delta: number) => void;
  onDecideFrame: (frameId: string, decision: CullDecision) => void;
  onExitCompare: () => void;
}

export const CompareView: React.FC<CompareViewProps> = ({
  leftFrame,
  rightFrame,
  previewProvider,
  needsAccess,
  zoomLevel,
  onZoomChange,
  panOffset,
  onPanChange,
  matchedZoom,
  onToggleMatchedZoom,
  onSwapPanes,
  onStepSide,
  onDecideFrame,
  onExitCompare,
}) => {
  const [rightZoom, setRightZoom] = useState(1);
  const [rightPan, setRightPan] = useState({ x: 0, y: 0 });
  const [draggingSide, setDraggingSide] = useState<'left' | 'right' | null>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const effectiveRightZoom = matchedZoom ? zoomLevel : rightZoom;
  const effectiveRightPan = matchedZoom ? panOffset : rightPan;

  const startDrag = (side: 'left' | 'right', e: React.PointerEvent<HTMLDivElement>) => {
    const activeZoom = side === 'left' ? zoomLevel : effectiveRightZoom;
    if (activeZoom <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingSide(side);
    const currentPan = side === 'left' || matchedZoom ? panOffset : rightPan;
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      px: currentPan.x,
      py: currentPan.y,
    };
  };

  const moveDrag = (side: 'left' | 'right', e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingSide !== side || !dragRef.current) return;
    const nextPan = {
      x: dragRef.current.px + (e.clientX - dragRef.current.x),
      y: dragRef.current.py + (e.clientY - dragRef.current.y),
    };
    if (side === 'left' || matchedZoom) {
      onPanChange(nextPan);
    } else {
      setRightPan(nextPan);
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    setDraggingSide(null);
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const renderPane = (
    side: 'left' | 'right',
    frame: PhotoFrame | null,
    paneZoom: number,
    panePan: { x: number; y: number }
  ) => {
    if (!frame) {
      return (
        <div className="flex-1 flex items-center justify-center bg-[#0B0C0E] border border-white/10 rounded-lg text-xs text-zinc-500">
          Select a frame for the {side} pane
        </div>
      );
    }

    const isKeep = frame.decision === 'keep';
    const isReject = frame.decision === 'reject';

    return (
      <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#121418] border border-white/10 rounded-lg overflow-hidden">
        {/* Pane Header */}
        <div className="shrink-0 px-3 py-2 bg-[#16181D] border-b border-white/8 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[11px] font-mono text-zinc-400 uppercase">
              {side === 'left' ? 'A' : 'B'}
            </span>
            <span className="text-xs font-semibold text-zinc-100 truncate">
              {frame.filename}
            </span>
            {frame.burstGroupId && (
              <span className="text-[11px] font-mono text-zinc-400 tabular-nums whitespace-nowrap">
                {frame.burstIndex}/{frame.burstCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onStepSide(side, -1)}
              aria-label={`Previous ${side} comparison frame`}
              className="p-1 text-zinc-400 hover:text-zinc-100 rounded bg-white/5 hover:bg-white/10"
            >
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onStepSide(side, 1)}
              aria-label={`Next ${side} comparison frame`}
              className="p-1 text-zinc-400 hover:text-zinc-100 rounded bg-white/5 hover:bg-white/10"
            >
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Image Surface */}
        <div
          onPointerDown={(e) => startDrag(side, e)}
          onPointerMove={(e) => moveDrag(side, e)}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => {
            const targetZoom = paneZoom > 1 ? 1 : 2;
            if (side === 'left' || matchedZoom) {
              onZoomChange(targetZoom);
              if (targetZoom === 1) onPanChange({ x: 0, y: 0 });
            } else {
              setRightZoom(targetZoom);
              if (targetZoom === 1) setRightPan({ x: 0, y: 0 });
            }
          }}
          className={`flex-1 relative bg-[#0A0B0D] overflow-hidden flex items-center justify-center p-2 ${
            paneZoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
          }`}
        >
          <FrameImage
            frame={frame}
            previewProvider={previewProvider}
            variant="full"
            needsAccess={needsAccess}
            zoomScale={paneZoom}
            panOffset={panePan}
            className="w-full h-full"
            imgClassName="object-contain"
          />
        </div>

        {/* Pane Footer Decision Bar */}
        <div className="shrink-0 px-3 py-2 bg-[#16181D] border-t border-white/8 flex items-center justify-between gap-2">
          <div className="text-[11px] font-mono text-zinc-400 tabular-nums truncate">
            {frame.exif.shutterSpeed || ''}
            {frame.exif.apertureF ? ` · f/${frame.exif.apertureF}` : ''}
            {frame.exif.iso ? ` · ISO ${frame.exif.iso}` : ''}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onDecideFrame(frame.id, isKeep ? 'unreviewed' : 'keep')}
              aria-label={`Keep ${frame.filename}`}
              aria-pressed={isKeep}
              className={`px-2.5 py-1 text-xs font-medium rounded border flex items-center gap-1 transition-colors ${
                isKeep
                  ? 'bg-sky-500/25 border-sky-400 text-sky-100'
                  : 'bg-[#1D2026] border-white/10 text-zinc-200 hover:bg-sky-500/15'
              }`}
            >
              <Check className="w-3.5 h-3.5 text-sky-300" aria-hidden="true" />
              <span>Keep</span>
            </button>
            <button
              type="button"
              onClick={() => onDecideFrame(frame.id, isReject ? 'unreviewed' : 'reject')}
              aria-label={`Reject ${frame.filename}`}
              aria-pressed={isReject}
              className={`px-2.5 py-1 text-xs font-medium rounded border flex items-center gap-1 transition-colors ${
                isReject
                  ? 'bg-orange-500/25 border-orange-400 text-orange-100'
                  : 'bg-[#1D2026] border-white/10 text-zinc-200 hover:bg-orange-500/15'
              }`}
            >
              <X className="w-3.5 h-3.5 text-orange-300" aria-hidden="true" />
              <span>Reject</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-[#0B0C0E] min-w-0 min-h-0">
      {/* Compare Toolbar */}
      <div className="shrink-0 bg-[#14161A] border-b border-white/10 px-4 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-zinc-300">
          <span className="font-semibold text-zinc-100">Side-by-Side Compare</span>
          <span className="text-zinc-500" aria-hidden="true">
            ·
          </span>
          <span className="text-zinc-400">
            Double-click or zoom to check eye sharpness across burst frames
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMatchedZoom}
            aria-pressed={matchedZoom}
            className={`px-2.5 py-1 text-xs font-medium rounded border flex items-center gap-1.5 transition-colors ${
              matchedZoom
                ? 'bg-sky-500/15 border-sky-400/50 text-sky-200'
                : 'bg-[#1D2026] border-white/10 text-zinc-300 hover:bg-[#262A32]'
            }`}
          >
            {matchedZoom ? (
              <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Link2Off className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>Matched Zoom &amp; Pan</span>
          </button>

          <div className="flex items-center gap-1 bg-[#1D2026] border border-white/10 rounded px-2 py-1 text-xs">
            <button
              type="button"
              onClick={() => {
                const next = Math.max(1, Number((zoomLevel - 0.5).toFixed(2)));
                onZoomChange(next);
                if (next <= 1) onPanChange({ x: 0, y: 0 });
              }}
              aria-label="Zoom out compare frames"
              className="text-zinc-400 hover:text-zinc-100"
            >
              <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <span className="font-mono tabular-nums min-w-[42px] text-center text-zinc-200">
              {zoomLevel === 1 ? 'Fit' : `${Math.round(zoomLevel * 100)}%`}
            </span>
            <button
              type="button"
              onClick={() => onZoomChange(Math.min(4, Number((zoomLevel + 0.5).toFixed(2))))}
              aria-label="Zoom in compare frames"
              className="text-zinc-400 hover:text-zinc-100"
            >
              <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            {zoomLevel > 1 && (
              <button
                type="button"
                onClick={() => {
                  onZoomChange(1);
                  onPanChange({ x: 0, y: 0 });
                }}
                aria-label="Reset compare zoom"
                className="ml-1 text-zinc-400 hover:text-zinc-100"
              >
                <RotateCcw className="w-3 h-3" aria-hidden="true" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onSwapPanes}
            className="px-2.5 py-1 text-xs font-medium rounded border border-white/10 bg-[#1D2026] hover:bg-[#262A32] text-zinc-200 flex items-center gap-1"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Swap</span>
          </button>

          <button
            type="button"
            onClick={onExitCompare}
            className="px-2.5 py-1 text-xs font-medium rounded border border-white/10 bg-[#1D2026] hover:bg-[#262A32] text-zinc-200"
          >
            Exit Compare
          </button>
        </div>
      </div>

      {/* Dual Panes */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 p-3 min-h-0">
        {renderPane('left', leftFrame, zoomLevel, panOffset)}
        {renderPane('right', rightFrame, effectiveRightZoom, effectiveRightPan)}
      </div>
    </div>
  );
};
