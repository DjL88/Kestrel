import type React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Undo2,
} from 'lucide-react';
import {
  type CommandId,
  type KeyBindingsMap,
  type KnobFunction,
} from '../core/keyboardCommands';
import type { PhotoFrame } from '../core/types';
import type { BrowserPreviewProvider } from '../providers/browserPreviewProvider';
import { PhotoViewport } from './PhotoViewport';
import { DecisionButtons } from './DecisionButtons';
import { isEdited } from '../core/editedState';
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
  onResetFrame: () => void;
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
  onResetFrame,
}) => {
  if (!frame) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-kestrel-stage text-zinc-400 p-8 text-center">
        <p className="text-sm font-medium text-zinc-300">No frames match this filter</p>
        <p className="text-xs text-zinc-500 mt-1">
          Switch back to All or adjust your search query to continue reviewing.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-kestrel-stage">
      <PhotoViewport
        zoom={zoomLevel} pan={panOffset} onTransform={(zoom, pan) => {
          onZoomChange(zoom);
          onPanChange(pan);
        }}
        base={<FrameImage frame={frame} previewProvider={previewProvider} variant="full"
          needsAccess={needsAccess} className="h-full w-full" imgClassName="object-contain" />}
      />
      <div className="absolute right-4 bottom-16 z-10 hidden lg:block">
        <ShortcutOverlay bindings={bindings} knobMode={knobMode} visible={showShortcutsOverlay} />
      </div>

      <div className="flex min-h-13 shrink-0 items-center justify-between gap-1 border-t border-white/8 bg-kestrel-panel px-1.5 sm:px-4">
        <button type="button" disabled={!hasPrev} onClick={() => onStepFrame(-1)} aria-label="Previous frame"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/8 disabled:opacity-30">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <DecisionButtons labels decision={frame.decision} filename={frame.filename} edited={isEdited(frame)}
            onKeep={() => onExecuteCommand('cull.keep')}
            onBackToReview={() => onExecuteCommand('cull.unreviewed')}
            onTrash={() => onExecuteCommand('cull.reject')}
            onReset={onResetFrame} />
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
