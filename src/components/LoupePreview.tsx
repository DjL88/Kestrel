import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  MoreHorizontal,
  Undo2,
} from 'lucide-react';
import { panToCentre } from '../core/eyeFinder';
import { zoomForPercent } from '../core/zoomControls';
import { locateEye } from '../providers/eyeLocator';
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
  /** Section F photo-only mode: no controls on top of the photograph. */
  focusPhoto?: boolean;
  onExecuteCommand: (commandId: CommandId) => void;
  onStepFrame: (delta: number) => void;
  onResetFrame: () => void;
  /** Open the same photo menu as a right-click, anchored at this point. */
  onOpenMenu?: (x: number, y: number) => void;
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
  focusPhoto = false,
  onExecuteCommand,
  onStepFrame,
  onResetFrame,
  onOpenMenu,
}) => {
  // Eye mode: zoom to the subject's eye now and on every photo stepped to, until switched off. Only the view moves.
  const viewRef = useRef<HTMLDivElement>(null);
  const [eyeMode, setEyeMode] = useState(false);
  const [eyeBusy, setEyeBusy] = useState(false);
  const [eyeNote, setEyeNote] = useState<string | null>(null);
  const request = useRef(0);
  const lookForEye = useCallback(async (target: PhotoFrame) => {
    const ticket = ++request.current;
    setEyeBusy(true);
    setEyeNote(null);
    try {
      const url = await previewProvider.getFullPreviewUrl(target, 'selected');
      if (!url) throw new Error('This preview is not available yet.');
      const image = new Image();
      image.src = url;
      await image.decode();
      const { eye, note } = await locateEye(image);
      if (ticket !== request.current) return;
      setEyeNote(note);
      const box = viewRef.current?.getBoundingClientRect();
      if (!eye || !box || !image.naturalWidth || !image.naturalHeight) return;
      const fit = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
      const zoom = Math.max(1, Math.min(6, zoomForPercent(200, fit, window.devicePixelRatio || 1)));
      onZoomChange(zoom);
      onPanChange(panToCentre(eye, { width: image.naturalWidth * fit, height: image.naturalHeight * fit }, zoom));
    } catch (error) {
      if (ticket === request.current) setEyeNote(error instanceof Error ? error.message : 'Could not look for the eye.');
    } finally {
      if (ticket === request.current) setEyeBusy(false);
    }
  }, [previewProvider, onZoomChange, onPanChange]);
  const frameId = frame?.id;
  useEffect(() => {
    if (!eyeMode || !frame) return;
    void lookForEye(frame);
    // Look again only when the photo changes, not when its decision or rating does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eyeMode, frameId, lookForEye]);
  const toggleEyeMode = () => {
    if (eyeMode) {
      request.current += 1;
      setEyeMode(false);
      setEyeBusy(false);
      setEyeNote(null);
      onZoomChange(1);
      onPanChange({ x: 0, y: 0 });
    } else {
      setEyeMode(true);
    }
  };

  if (!frame) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-kestrel-stage text-zinc-400 p-8 text-center">
        <p className="text-sm font-medium text-zinc-300">No frames match this filter</p>
        <p className="text-xs text-zinc-400 mt-1">
          Switch back to All or adjust your search query to continue reviewing.
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-kestrel-stage">
      <div ref={viewRef} data-photo-stage tabIndex={0} aria-label="Photo canvas"
        className="relative flex min-h-0 flex-1 flex-col focus-visible:outline-2 focus-visible:outline-sky-300">
        <PhotoViewport
          zoom={zoomLevel} pan={panOffset} onTransform={(zoom, pan) => {
            onZoomChange(zoom);
            onPanChange(pan);
          }}
          base={<FrameImage frame={frame} previewProvider={previewProvider} variant="full"
            needsAccess={needsAccess} className="h-full w-full" imgClassName="object-contain" />}
        />
      </div>
      {!focusPhoto && <div className="absolute right-4 bottom-16 z-10 hidden lg:block">
        <ShortcutOverlay bindings={bindings} knobMode={knobMode} visible={showShortcutsOverlay} />
      </div>}

      {!focusPhoto && <div role="group" aria-label="Single photo controls" className="flex min-h-13 shrink-0 items-center justify-between gap-1 border-t border-white/8 bg-kestrel-panel px-1.5 sm:px-4">
        <button type="button" disabled={!hasPrev} onClick={() => onStepFrame(-1)} aria-label="Previous frame" title="Previous frame"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/8 disabled:opacity-30">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <DecisionButtons labels decision={frame.decision} filename={frame.filename} edited={isEdited(frame)}
            onKeep={() => onExecuteCommand('cull.keep')}
            onBackToReview={() => onExecuteCommand('cull.unreviewed')}
            onTrash={() => onExecuteCommand('cull.reject')}
            onReset={onResetFrame} />
          <button type="button" disabled={!canUndo} onClick={() => onExecuteCommand('cull.undo')} aria-label="Undo last decision" title="Undo last decision"
            className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-sm text-zinc-200 hover:bg-white/8 disabled:invisible sm:gap-1.5 sm:px-2.5">
            <Undo2 className="h-4 w-4" aria-hidden="true" /><span className="hidden min-[360px]:inline">Undo</span>
          </button>
          <button type="button" aria-label="Eye" aria-pressed={eyeMode} onClick={toggleEyeMode}
            title={eyeMode ? 'Eye on: every photo opens zoomed to the eye. Press to go back to the whole photo.' : 'Zoom to the eye, and keep doing so on every photo'}
            className="hidden h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-sm text-zinc-200 hover:bg-white/8 aria-pressed:bg-white/15 sm:inline-flex sm:gap-1.5 sm:px-2.5">
            <Eye className="h-4 w-4" aria-hidden="true" /><span className="hidden min-[360px]:inline">{eyeBusy ? 'Eye…' : 'Eye'}</span>
          </button>
          {eyeNote && <span role="status" className="sr-only text-xs text-zinc-300 lg:not-sr-only lg:max-w-56 lg:truncate">{eyeNote}</span>}
          {onOpenMenu && (
            <button type="button" aria-haspopup="menu" aria-label={`More actions for ${frame.filename}`} title="More: reset edit, duplicate, copy adjustments, rate, export"
              onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); onOpenMenu(box.left, box.top); }}
              className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-sm text-zinc-200 hover:bg-white/8 sm:gap-1.5 sm:px-2.5">
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" /><span className="hidden min-[360px]:inline">More</span>
            </button>
          )}
        </div>
        <button type="button" disabled={!hasNext} onClick={() => onStepFrame(1)} aria-label="Next frame" title="Next frame"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/8 disabled:opacity-30">
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>}
    </div>
  );
};
