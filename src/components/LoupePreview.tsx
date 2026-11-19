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
import { maxZoomFor, zoomForPercent } from '../core/zoomControls';
import { ZoomControls } from './ZoomControls';
import { PhotoJump } from './PhotoJump';
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
  /** Current position in the same filtered visible shoot used by the filmstrip. */
  photoIndex: number;
  photoCount: number;
  onJumpToIndex: (index: number) => void;
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
  photoIndex,
  photoCount,
  onJumpToIndex,
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

  // How big the shown picture is and how much room it has, so the zoom level reads in the same percent as the editor's.
  const [measure, setMeasure] = useState<{ fit: number }>({ fit: 0 });
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let timer: number | undefined;
    const update = () => {
      const image = view.querySelector('img');
      const box = view.getBoundingClientRect();
      if (image?.naturalWidth && box.width) {
        setMeasure({ fit: Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight) });
      } else {
        timer = window.setTimeout(update, 250);
      }
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(view);
    return () => { window.clearTimeout(timer); observer?.disconnect(); };
  }, [frameId]);
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

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

      {/* The same order as the editor's bottom bar: previous and next on the left, this view's actions, zoom on the right. */}
      {!focusPhoto && <div role="group" aria-label="Single photo controls" className="mobile-toolbar-scroll flex min-h-13 shrink-0 items-center gap-1 overflow-x-auto border-t border-white/8 bg-kestrel-panel px-1.5 sm:px-4">
        <button type="button" disabled={!hasPrev} onClick={() => onStepFrame(-1)} aria-label="Previous frame" title="Previous frame (←)"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/8 disabled:opacity-30">
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <button type="button" disabled={!hasNext} onClick={() => onStepFrame(1)} aria-label="Next frame" title="Next frame (→)"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-white/8 disabled:opacity-30">
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
        {/* Phones have no room for Jump beside the decisions; they swipe or step, and the grid has Jump too. */}
        <div className="max-sm:hidden"><PhotoJump index={photoIndex} total={photoCount} onJump={onJumpToIndex} /></div>
        {/* Centred with auto margins, not justify-center: when space runs short it never spills over Jump. */}
        <div className="mx-auto flex shrink-0 items-center gap-1 sm:gap-2">
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
            title={eyeMode ? 'Stop following the eye' : 'Zoom to the eye and follow it across photos'}
            className="hidden h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-zinc-200 hover:bg-white/8 aria-pressed:bg-white/15 min-[360px]:max-sm:inline-flex">
            <Eye className="h-5 w-5" aria-hidden="true" />
          </button>
          {onOpenMenu && (
            <button type="button" aria-haspopup="menu" aria-label={`More actions for ${frame.filename}`} title="More: reset edit, duplicate, copy adjustments, rate, export"
              onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); onOpenMenu(box.left, box.top); }}
              className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-sm text-zinc-200 hover:bg-white/8 sm:gap-1.5 sm:px-2.5">
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" /><span className="hidden min-[360px]:inline">More</span>
            </button>
          )}
        </div>
        {/* Same full zoom controls as Edit on desktop/tablet. On small phones, the compact Eye button remains accessible and pinch zoom remains available. */}
        <ZoomControls className="max-sm:hidden" zoom={zoomLevel} fit={measure.fit} dpr={dpr} maxZoom={maxZoomFor(measure.fit || 1, dpr)} note={eyeNote}
          onZoom={(zoom) => { onZoomChange(zoom); if (zoom === 1) onPanChange({ x: 0, y: 0 }); }}
          eye={{ onClick: toggleEyeMode, busy: eyeBusy, pressed: eyeMode,
            title: eyeMode ? 'Eye on: every photo opens zoomed to the eye. Press to go back to the whole photo.' : 'Zoom to the eye, and keep doing so on every photo' }} />
      </div>}
    </div>
  );
};
