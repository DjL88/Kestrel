import React, { useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Undo2,
  X,
} from 'lucide-react';
import {
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
  canUndo: boolean;
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
  canUndo,
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
    if (zoomLevel <= 1 || (e.target instanceof Element && e.target.closest('button'))) return;
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
        className={`flex-1 relative flex items-center justify-center overflow-hidden p-2 sm:p-4 ${
          zoomLevel > 1 ? (dragging ? 'touch-none cursor-grabbing' : 'touch-none cursor-grab') : 'cursor-default'
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

        <button
          type="button"
          onClick={() => onExecuteCommand('cull.toggleZoom')}
          onDoubleClick={(event) => event.stopPropagation()}
          aria-label={zoomLevel === 1 ? 'Zoom in' : 'Fit photo'}
          className="absolute top-2 right-2 min-h-11 min-w-11 rounded-md bg-black/65 px-2 text-xs tabular-nums text-zinc-200 hover:bg-black/90"
        >
          {zoomLevel === 1 ? 'Fit' : `${Math.round(zoomLevel * 100)}%`}
        </button>

        {/* Quiet Optional Shortcut Overlay */}
        <div className="absolute bottom-3 right-4 z-10 hidden lg:block">
          <ShortcutOverlay
            bindings={bindings}
            knobMode={knobMode}
            visible={showShortcutsOverlay}
          />
        </div>
      </div>

      <div className="flex min-h-13 shrink-0 items-center justify-between gap-1 border-t border-white/8 bg-[#14161A] px-1.5 sm:px-4">
        <button type="button" disabled={!hasPrev} onClick={() => onStepFrame(-1)} aria-label="Previous frame"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/8 disabled:opacity-30">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <button type="button" aria-pressed={frame.decision === 'keep'} onClick={() => onExecuteCommand('cull.keep')}
            className="inline-flex h-11 items-center gap-1.5 rounded-md px-2.5 text-sm text-zinc-200 hover:bg-white/8 aria-pressed:bg-sky-300/15 aria-pressed:text-sky-200">
            <Check className="h-4 w-4" aria-hidden="true" /> Keep
          </button>
          <button type="button" aria-pressed={frame.decision === 'reject'} onClick={() => onExecuteCommand('cull.reject')}
            className="inline-flex h-11 items-center gap-1.5 rounded-md px-2.5 text-sm text-zinc-200 hover:bg-white/8 aria-pressed:bg-orange-300/15 aria-pressed:text-orange-200">
            <X className="h-4 w-4" aria-hidden="true" /> Reject
          </button>
          <button type="button" disabled={!canUndo} onClick={() => onExecuteCommand('cull.undo')} aria-label="Undo last decision"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/8 disabled:invisible">
            <Undo2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <button type="button" disabled={!hasNext} onClick={() => onStepFrame(1)} aria-label="Next frame"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/8 disabled:opacity-30">
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
