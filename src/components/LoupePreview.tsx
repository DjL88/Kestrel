import React, { useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Columns2,
  Redo2,
  RotateCcw,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  formatChordLabel,
  type CommandId,
  type KeyBindingsMap,
  type KnobFunction,
} from '../core/keyboardCommands';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import { FrameImage } from './FrameImage';
import { ShortcutOverlay } from './ShortcutOverlay';

interface LoupePreviewProps {
  frame: PhotoFrame | null;
  previewProvider: BrowserPreviewProvider;
  zoomLevel: number;
  onZoomChange: (next: number) => void;
  panOffset: { x: number; y: number };
  onPanChange: (next: { x: number; y: number }) => void;
  autoAdvance: boolean;
  onToggleAutoAdvance: () => void;
  canUndo: boolean;
  canRedo: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  needsAccess: boolean;
  bindings: KeyBindingsMap;
  knobMode: KnobFunction;
  showShortcutsOverlay: boolean;
  onExecuteCommand: (commandId: CommandId) => void;
  onStepFrame: (delta: number) => void;
}

export const LoupePreview: React.FC<LoupePreviewProps> = ({
  frame,
  previewProvider,
  zoomLevel,
  onZoomChange,
  panOffset,
  onPanChange,
  autoAdvance,
  onToggleAutoAdvance,
  canUndo,
  canRedo,
  hasPrev,
  hasNext,
  needsAccess,
  bindings,
  knobMode,
  showShortcutsOverlay,
  onExecuteCommand,
  onStepFrame,
}) => {
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(
    null
  );

  if (!frame) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0D0E11] text-zinc-400 p-8 text-center">
        <p className="text-sm font-medium text-zinc-300">No frames match this filter</p>
        <p className="text-xs text-zinc-500 mt-1">
          Switch back to All or adjust your search query to continue reviewing.
        </p>
      </div>
    );
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoomLevel <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: panOffset.x,
      panY: panOffset.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    onPanChange({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    dragStartRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) < 4) return;
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const next = Math.max(1, Math.min(4, Number((zoomLevel * factor).toFixed(2))));
    onZoomChange(next);
    if (next <= 1) onPanChange({ x: 0, y: 0 });
  };

  const decisionCue =
    frame.decision === 'keep'
      ? {
          label: 'Keep',
          icon: <Check className="w-4 h-4" aria-hidden="true" />,
          classes: 'bg-sky-500/20 text-sky-200 border-sky-400/50',
        }
      : frame.decision === 'reject'
      ? {
          label: 'Reject',
          icon: <X className="w-4 h-4" aria-hidden="true" />,
          classes: 'bg-orange-500/20 text-orange-200 border-orange-400/50',
        }
      : {
          label: 'Unreviewed',
          icon: <CircleDashed className="w-4 h-4" aria-hidden="true" />,
          classes: 'bg-[#14161A]/85 text-zinc-300 border-white/15',
        };

  return (
    <div className="flex-1 flex flex-col bg-[#0B0C0E] min-w-0 min-h-0 relative">
      {/* Main Photograph Stage */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={() => onExecuteCommand('cull.toggleZoom')}
        onWheel={handleWheel}
        className={`flex-1 relative flex items-center justify-center overflow-hidden p-4 sm:p-6 ${
          zoomLevel > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
        }`}
      >
        <div className="w-full h-full flex items-center justify-center">
          <div className="relative w-full h-full max-w-full max-h-full flex items-center justify-center">
            <FrameImage
              frame={frame}
              previewProvider={previewProvider}
              variant="full"
              needsAccess={needsAccess}
              zoomScale={zoomLevel}
              panOffset={panOffset}
              className="w-full h-full rounded-md"
              imgClassName="object-contain"
            />
          </div>
        </div>

        {/* Top-Left Decision & Burst Context */}
        <div className="absolute top-3 left-4 flex items-center gap-2 pointer-events-none">
          <div
            data-testid="loupe-decision-indicator"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold backdrop-blur-sm ${decisionCue.classes}`}
          >
            {decisionCue.icon}
            <span>{decisionCue.label}</span>
          </div>

          {frame.burstGroupId && (
            <div className="px-2.5 py-1 rounded-md bg-[#14161A]/85 border border-white/10 text-xs text-zinc-300 font-mono tabular-nums backdrop-blur-sm">
              Burst {frame.burstGroupId.replace('burst-', '')} · {frame.burstIndex}/
              {frame.burstCount}
            </div>
          )}

          {frame.exif.isEmbeddedPreviewOnly && (
            <div className="px-2.5 py-1 rounded-md bg-amber-500/15 border border-amber-400/30 text-[11px] text-amber-200 backdrop-blur-sm">
              Embedded NEF preview — full RAW decode requires desktop build
            </div>
          )}
        </div>

        {/* Top-Right Zoom Readout */}
        <div className="absolute top-3 right-4 flex items-center gap-1.5 bg-[#14161A]/85 border border-white/10 rounded-md px-2 py-1 text-xs text-zinc-300 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => {
              const next = Math.max(1, Number((zoomLevel - 0.5).toFixed(2)));
              onZoomChange(next);
              if (next <= 1) onPanChange({ x: 0, y: 0 });
            }}
            aria-label="Zoom out"
            className="p-0.5 text-zinc-400 hover:text-zinc-100 rounded focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <span className="font-mono tabular-nums min-w-[44px] text-center">
            {zoomLevel === 1 ? 'Fit' : `${Math.round(zoomLevel * 100)}%`}
          </span>
          <button
            type="button"
            onClick={() => onZoomChange(Math.min(4, Number((zoomLevel + 0.5).toFixed(2))))}
            aria-label="Zoom in"
            className="p-0.5 text-zinc-400 hover:text-zinc-100 rounded focus-visible:outline-2 focus-visible:outline-sky-400"
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
              aria-label="Reset zoom to fit"
              className="ml-1 p-0.5 text-zinc-400 hover:text-zinc-100 rounded focus-visible:outline-2 focus-visible:outline-sky-400"
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Quiet Optional Shortcut Overlay */}
        <div className="absolute bottom-3 right-4 z-10">
          <ShortcutOverlay
            bindings={bindings}
            knobMode={knobMode}
            visible={showShortcutsOverlay}
          />
        </div>
      </div>

      {/* Bottom Decision & Navigation Control Strip (Shared Command Handler) */}
      <div className="shrink-0 bg-[#14161A] border-t border-white/10 px-4 py-2 flex flex-wrap items-center justify-between gap-3">
        {/* Prev / Next Navigation */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() => onStepFrame(-1)}
            aria-label="Previous frame"
            className="px-2.5 py-1.5 text-xs font-medium bg-[#1D2026] hover:bg-[#262A32] disabled:opacity-40 disabled:pointer-events-none text-zinc-200 border border-white/10 rounded-md flex items-center gap-1 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Prev</span>
          </button>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => onStepFrame(1)}
            aria-label="Next frame"
            className="px-2.5 py-1.5 text-xs font-medium bg-[#1D2026] hover:bg-[#262A32] disabled:opacity-40 disabled:pointer-events-none text-zinc-200 border border-white/10 rounded-md flex items-center gap-1 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <span>Next</span>
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Primary Culling Decisions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onExecuteCommand('cull.keep')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md border flex items-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
              frame.decision === 'keep'
                ? 'bg-sky-500/25 border-sky-400 text-sky-100'
                : 'bg-[#1D2026] border-white/12 text-zinc-100 hover:bg-sky-500/15 hover:border-sky-400/50'
            }`}
          >
            <Check className="w-3.5 h-3.5 text-sky-300" aria-hidden="true" />
            <span>Keep</span>
            <kbd className="ml-1 font-mono text-[10px] text-zinc-400">
              {formatChordLabel(bindings['cull.keep'])}
            </kbd>
          </button>

          <button
            type="button"
            onClick={() => onExecuteCommand('cull.reject')}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md border flex items-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-orange-400 ${
              frame.decision === 'reject'
                ? 'bg-orange-500/25 border-orange-400 text-orange-100'
                : 'bg-[#1D2026] border-white/12 text-zinc-100 hover:bg-orange-500/15 hover:border-orange-400/50'
            }`}
          >
            <X className="w-3.5 h-3.5 text-orange-300" aria-hidden="true" />
            <span>Reject</span>
            <kbd className="ml-1 font-mono text-[10px] text-zinc-400">
              {formatChordLabel(bindings['cull.reject'])}
            </kbd>
          </button>

          <button
            type="button"
            onClick={() => onExecuteCommand('cull.unreviewed')}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-white/10 bg-[#1D2026] hover:bg-[#262A32] text-zinc-300 flex items-center gap-1 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <CircleDashed className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
            <span>Clear</span>
          </button>

          <div className="w-px h-5 bg-white/10 mx-1" aria-hidden="true" />

          <button
            type="button"
            disabled={!canUndo}
            onClick={() => onExecuteCommand('cull.undo')}
            aria-label="Undo last decision"
            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-white/10 bg-[#1D2026] hover:bg-[#262A32] disabled:opacity-40 disabled:pointer-events-none text-zinc-200 flex items-center gap-1 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Undo</span>
          </button>

          <button
            type="button"
            disabled={!canRedo}
            onClick={() => onExecuteCommand('cull.redo')}
            aria-label="Redo decision"
            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-white/10 bg-[#1D2026] hover:bg-[#262A32] disabled:opacity-40 disabled:pointer-events-none text-zinc-200 flex items-center gap-1 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <Redo2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Redo</span>
          </button>

          <button
            type="button"
            onClick={() => onExecuteCommand('cull.compare')}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-white/10 bg-[#1D2026] hover:bg-[#262A32] text-zinc-200 flex items-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-sky-400"
          >
            <Columns2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Compare</span>
          </button>
        </div>

        {/* Auto-advance Toggle */}
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoAdvance}
            onChange={onToggleAutoAdvance}
            className="rounded border-white/20 bg-[#0D0E11] text-sky-400 focus:ring-sky-400"
          />
          <span>Auto-advance</span>
        </label>
      </div>
    </div>
  );
};
