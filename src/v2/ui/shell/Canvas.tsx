import { stepFrom, swipeIntent } from '../utils/swipe';
import { cropHandleZoom, type CropHandleSide } from '../utils/cropHandleZoom';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { nextCanvasZoom, zoomAnchorScroll } from '../utils/canvasTrackpadZoom';
import { maxCanvasPixels } from '../../../core/exportLimits';
import { ORIGINAL_FORMAT_ID } from '../../engineClient/formatOps';
import { STACK_GAP_PX, alignForAnchor, anchorFlexStyle, freeTransform, stacked } from '../utils/overlayLayout';
import type {
  CropTransform,
  EditGroup,
  FeatureKey,
  FontOption,
  LookPreset,
  MaskGeometryField,
  OverlaySettings,
  Photo,
  PhotoSurfaceProps,
  SizePreset,
  VideoZoomConfig,
  WatermarkPreset,
} from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import PictureSourceBadge from './PictureSourceBadge';
import CompareSplit from './CompareSplit';
import MaskOutlineLayer from './MaskOutlineLayer';
import { MAX_SPLIT_FRAMES, type SplitFrameCount } from '../../engineClient/formatSplitOps';
import { captureElement, screenshotName } from '../utils/captureElement';
import { findEyeOnScreen } from '../../engineClient/eyeZoom';
import { DOCKED, clampDockOffset, isDocked, nudgeDockOffset, parseDockOffset, snapDockOffset, type DockOffset } from '../utils/floatingDock';
import {
  buildPreviewFilterCss,
  cropPanLimits,
  clamp,
  detectOverlayOverflow,
  effectiveUpscaleOutputSize,
  formatOverlayRowText,
  maxRowSizePx,
  getActiveGroup,
  snapOverlayPosition,
  type SnapGeometry,
  type SnapGuide,
} from '../utils/studioMath';

interface CanvasProps {
  /** Engine-supplied renderer; falls back to a plain image. */
  PhotoSurface?: React.ComponentType<PhotoSurfaceProps>;
  maskGuideId?: string;
  /** The selected mask's hatched coverage overlay; its outline stays visible either way. */
  maskOverlayVisible?: boolean;
  /** The overlay key as the person reads it ("O"), or undefined when unbound. */
  maskOverlayKey?: string;
  onToggleMaskOverlay?: () => void;
  onSetMaskGeometry?: (photoId: string, maskId: string, field: MaskGeometryField, value: number) => void;
  photo: Photo | null;
  activeSizeId: string;
  selectedSizeIds: string[];
  canvasLayoutMode: 'single' | 'all-formats';
  hoveredLook: LookPreset | null;
  fonts: FontOption[];
  watermarkPresets: WatermarkPreset[];
  features: Record<FeatureKey, boolean>;
  compareMode: boolean;
  canvasZoom: number;
  isFullScreen: boolean;
  hideHints: boolean;
  onSelectSize: (sizeId: string, modifiers?: { ctrl?: boolean; shift?: boolean; available?: readonly string[] }) => void;
  onClearSizeSelection: () => void;
  /** Phone swipe left or right on the photo: go to the next (1) or previous (-1) photo. */
  onStepPhoto?: (delta: 1 | -1) => void;
  /** The small action bar by the format: open the Formats tool, duplicate or delete this format. */
  onOpenFormats?: () => void;
  onDuplicateSize?: (sizeId: string) => void;
  onRemoveSize?: (sizeId: string) => void;
  onSelectAllSizes: (photoId: string, availableIds?: readonly string[]) => void;
  onSetLayoutMode: (mode: 'single' | 'all-formats') => void;
  onMoveArtboard: (photoId: string, sizeId: string, boardX: number, boardY: number) => void;
  onResetArtboards: (photoId: string) => void;
  onUpdateCrop: (photoId: string, sizeId: string, patch: Partial<CropTransform>) => void;
  onFlipSizes: (photoId: string, axis: 'horizontal' | 'vertical') => void;
  onRotateSizes: (photoId: string) => void;
  onToggleSplitFrames: (photoId: string) => void;
  /** Set the active format's number of continuous frames (1 rejoins, up to 5). */
  onSetSplitFrameCount?: (photoId: string, sizeId: string, count: SplitFrameCount) => void;
  onSetSplitPanOffset: (photoId: string, offset: number) => void;
  onUpdateVideoZoom: (photoId: string, patch: Partial<VideoZoomConfig>) => void;
  onUpdateOverlay: (photoId: string, patch: Partial<OverlaySettings>) => void;
  onReconnectOriginal: (photoId: string) => void;
  onDevelopFullSize?: (photoId: string) => void;
  onToggleCompare: () => void;
  onSetZoom: (zoom: number) => void;
  /** Called when someone zooms a cloud preview past 100%: its pixels run out there, so the original may be wanted. */
  onZoomPastPreview?: (photoId: string) => void;
  onToggleFullScreen: () => void;
}

const ZOOM_BAR_STORAGE_KEY = 'inflight.v2.zoomBarOffset';

/** Tells the store once when a cloud preview is zoomed past 100%, so it can offer the original. */
function ZoomPastPreviewSignal({ active, photoId, onZoomPastPreview }: { active: boolean; photoId: string; onZoomPastPreview?: (photoId: string) => void }) {
  useEffect(() => { if (active) onZoomPastPreview?.(photoId); }, [active, photoId, onZoomPastPreview]);
  return null;
}

export default function Canvas({
  PhotoSurface,
  maskGuideId,
  maskOverlayVisible = true,
  maskOverlayKey,
  onToggleMaskOverlay,
  onSetMaskGeometry,
  photo,
  activeSizeId,
  selectedSizeIds,
  canvasLayoutMode,
  hoveredLook,
  fonts,
  watermarkPresets,
  features,
  compareMode: compareRequested,
  canvasZoom,
  isFullScreen,
  hideHints,
  onSelectSize,
  onClearSizeSelection,
  onStepPhoto,
  onOpenFormats,
  onDuplicateSize,
  onRemoveSize,
  onSelectAllSizes,
  onSetLayoutMode,
  onMoveArtboard,
  onResetArtboards,
  onUpdateCrop,
  onFlipSizes,
  onRotateSizes,
  onToggleSplitFrames,
  onSetSplitFrameCount,
  onSetSplitPanOffset,
  onUpdateVideoZoom,
  onUpdateOverlay,
  onReconnectOriginal,
  onDevelopFullSize,
  onToggleCompare,
  onSetZoom,
  onZoomPastPreview,
  onToggleFullScreen,
}: CanvasProps) {
  const [activeGuides, setActiveGuides] = useState<SnapGuide[]>([]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // The stage and the canvas column only exist once a photo is open. Canvas often mounts first with no photo (a new or
  // empty project), so the listeners and size observer below must follow the elements themselves, not the first render:
  // with a one-off effect they were never attached, a trackpad pinch zoomed the whole page (menus and all), and Fit used
  // a made-up 660×470 stage, so the photo ran off the side of phones and portrait tablets.
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const [columnEl, setColumnEl] = useState<HTMLElement | null>(null);
  const attachStage = (el: HTMLDivElement | null) => { stageRef.current = el; setStageEl(el); };
  const zoomRef = useRef(canvasZoom);
  zoomRef.current = canvasZoom;
  const setZoomRef = useRef(onSetZoom);
  setZoomRef.current = onSetZoom;
  const zoomAnchor = useRef<{ x: number; y: number; left: number; top: number; zoom: number } | null>(null);
  /** Zoom to eye: after the zoom is laid out, scroll this point (a share across the frame) to the middle of the view. */
  const centreOn = useRef<{ fx: number; fy: number } | null>(null);
  const [eyeTarget, setEyeTarget] = useState(0);

  // Chromium (including Windows precision touchpads) delivers pinch as Ctrl+wheel.
  // Listen non-passively on the whole canvas column (the photo, the margin round it and the bar above it), so a pinch
  // anywhere over the canvas zooms the photo and never the page. Side panels and the filmstrip keep browser behaviour.
  // Normal two-finger scrolling remains the browser's native stage scroll.
  useEffect(() => {
    const stage = stageEl;
    const column = columnEl;
    if (!stage || !column) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      // A text or number field keeps its own Ctrl+wheel. Over a toolbar button the pinch still zooms the photo.
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const next = nextCanvasZoom(zoomRef.current, event.deltaY, event.deltaMode);
      if (next === zoomRef.current) return;
      zoomAnchor.current = {
        // A pinch over the bar above the stage anchors on the nearest point of the stage.
        x: clamp(event.clientX - rect.left, 0, rect.width), y: clamp(event.clientY - rect.top, 0, rect.height),
        left: stage.scrollLeft, top: stage.scrollTop, zoom: zoomRef.current,
      };
      zoomRef.current = next;
      setZoomRef.current(next);
    };
    // Safari on macOS exposes a separate magnification gesture rather than Ctrl+wheel.
    // Keep the handler scoped to the photo stage, not the whole document.
    let safariStartZoom = zoomRef.current;
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      safariStartZoom = zoomRef.current;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as Event & { scale?: number; clientX?: number; clientY?: number };
      if (!Number.isFinite(gesture.scale) || !gesture.scale || gesture.scale <= 0) return;
      const rect = stage.getBoundingClientRect();
      const next = Math.max(0.25, Math.min(8, safariStartZoom * gesture.scale));
      const x = clamp((gesture.clientX ?? rect.left + rect.width / 2) - rect.left, 0, rect.width);
      const y = clamp((gesture.clientY ?? rect.top + rect.height / 2) - rect.top, 0, rect.height);
      zoomAnchor.current = { x, y, left: stage.scrollLeft, top: stage.scrollTop, zoom: zoomRef.current };
      zoomRef.current = next;
      setZoomRef.current(next);
    };
    const onGestureEnd = (event: Event) => { event.preventDefault(); };
    column.addEventListener('wheel', onWheel, { passive: false });
    column.addEventListener('gesturestart', onGestureStart, { passive: false });
    column.addEventListener('gesturechange', onGestureChange, { passive: false });
    column.addEventListener('gestureend', onGestureEnd, { passive: false });
    return () => {
      column.removeEventListener('wheel', onWheel);
      column.removeEventListener('gesturestart', onGestureStart);
      column.removeEventListener('gesturechange', onGestureChange);
      column.removeEventListener('gestureend', onGestureEnd);
    };
  }, [stageEl, columnEl]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const anchor = zoomAnchor.current;
    if (!stage || !anchor || anchor.zoom === canvasZoom) return;
    stage.scrollLeft = zoomAnchorScroll(anchor.left, anchor.x, anchor.zoom, canvasZoom);
    stage.scrollTop = zoomAnchorScroll(anchor.top, anchor.y, anchor.zoom, canvasZoom);
    zoomAnchor.current = null;
  }, [canvasZoom]);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const point = centreOn.current;
    const frame = stage?.querySelector('[data-testid="canvas-frame"]');
    if (!stage || !point || !frame) return;
    centreOn.current = null;
    // Measured after layout, so centring, padding and the frame's own zoom are all accounted for.
    const frameRect = frame.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    stage.scrollLeft += frameRect.left + point.fx * frameRect.width - (stageRect.left + stage.clientWidth / 2);
    stage.scrollTop += frameRect.top + point.fy * frameRect.height - (stageRect.top + stage.clientHeight / 2);
  }, [canvasZoom, eyeTarget]);

  // The zoom bar stays fixed over the canvas. It can be undocked: drag its grip (or use the arrow keys on it) to move
  // it anywhere over the canvas; double-click the grip, press Home on it, or drop it near the corner to dock it again.
  const viewportRef = useRef<HTMLDivElement>(null);
  const zoomBarRef = useRef<HTMLDivElement>(null);
  const zoomBarDrag = useRef<{ pointerId: number; x: number; y: number; start: DockOffset } | null>(null);
  const [zoomBarOffset, setZoomBarOffset] = useState<DockOffset>(() => {
    try { return parseDockOffset(window.localStorage.getItem(ZOOM_BAR_STORAGE_KEY)); } catch { return DOCKED; }
  });
  const clampZoomBar = (offset: DockOffset): DockOffset => {
    const area = viewportRef.current?.getBoundingClientRect();
    const bar = zoomBarRef.current?.getBoundingClientRect();
    return area && bar ? clampDockOffset(offset, area, bar) : offset;
  };
  const saveZoomBarOffset = (offset: DockOffset) => {
    setZoomBarOffset(offset);
    try { window.localStorage.setItem(ZOOM_BAR_STORAGE_KEY, JSON.stringify(offset)); } catch { /* the place is a convenience only */ }
  };
  const startZoomBarDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    zoomBarDrag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: zoomBarOffset };
  };
  const moveZoomBar = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const drag = zoomBarDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setZoomBarOffset(clampZoomBar({ right: drag.start.right - (event.clientX - drag.x), bottom: drag.start.bottom - (event.clientY - drag.y) }));
  };
  const endZoomBarDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const drag = zoomBarDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    zoomBarDrag.current = null;
    saveZoomBarOffset(snapDockOffset(clampZoomBar({ right: drag.start.right - (event.clientX - drag.x), bottom: drag.start.bottom - (event.clientY - drag.y) })));
  };
  // A window or panel resize never leaves the undocked bar out of sight.
  useEffect(() => {
    const area = viewportRef.current;
    if (!area || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setZoomBarOffset((offset) => {
      const next = clampZoomBar(offset);
      return next.right === offset.right && next.bottom === offset.bottom ? offset : next;
    }));
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  const [shotNote, setShotNote] = useState<string | null>(null);
  /** The menu on the zoom percentage: Fit, 100% and Zoom to eye. */
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const zoomMenuRef = useRef<HTMLDivElement>(null);
  const zoomPercentRef = useRef<HTMLButtonElement>(null);
  /** What Zoom to eye did, in words. It stays until dismissed or the photo changes, never vanishing on a timer. */
  const [eyeNote, setEyeNote] = useState<{ text: string; busy: boolean } | null>(null);
  useEffect(() => { setEyeNote(null); setZoomMenuOpen(false); }, [photo?.id]);
  useEffect(() => {
    if (!zoomMenuOpen) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!zoomMenuRef.current?.contains(target) && !zoomPercentRef.current?.contains(target)) setZoomMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setZoomMenuOpen(false);
      zoomPercentRef.current?.focus();
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onPointer); window.removeEventListener('keydown', onKey, true); };
  }, [zoomMenuOpen]);
  /** Saves what is on the canvas right now, as seen: the edit, crop, overlays, grid and compare split. */
  const grabScreenshot = async () => {
    const stage = stageRef.current;
    if (!stage || !photo) return;
    setShotNote('Taking the screenshot…');
    try {
      const blob = await captureElement(stage);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = screenshotName(photo.title || photo.filename, new Date());
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      setShotNote('Screenshot saved to your downloads.');
    } catch (error) {
      setShotNote(error instanceof Error ? error.message : 'The screenshot could not be taken.');
    }
    window.setTimeout(() => setShotNote(null), 5000);
  };
  const [stageSize, setStageSize] = useState({ width: 660, height: 470 });
  const touchPoints = useRef(new Map<number, { x: number; y: number }>());
  const touchGesture = useRef<{ distance: number; zoom: number; panX: number; panY: number; centreX: number; centreY: number; lastCentreX: number; lastCentreY: number } | null>(null);
  const touchPan = useRef<{ x: number; y: number } | null>(null);
  /** A mouse or pen dragging the empty stage to move round a zoomed-in photo. */
  const marginPan = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const [marginPanning, setMarginPanning] = useState(false);
  useEffect(() => {
    const stage = stageEl;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stageEl]);
  const [holdingOriginal, setHoldingOriginal] = useState(false);
  const swipeRef = useRef<{ x: number; y: number; t: number; pinched: boolean } | null>(null);
  const holdRef = useRef<{ timer: number | null; x: number; y: number; active: boolean }>({ timer: null, x: 0, y: 0, active: false });
  const [draggingType, setDraggingType] = useState<'none' | 'pan' | 'crop' | 'text' | 'watermark' | 'board'>('none');

  const dragRef = useRef<{
    kind: 'pan' | 'crop-top' | 'crop-right' | 'crop-bottom' | 'crop-left' | 'scale-top' | 'scale-right' | 'scale-bottom' | 'scale-left' | 'scale-tl' | 'scale-tr' | 'scale-bl' | 'scale-br' | 'move-frame' | 'text' | 'watermark' | 'resize-text' | 'resize-watermark' | 'board' | 'split';
    sizeId: string;
    startX: number;
    startY: number;
    origA: number;
    origB: number;
    /** The format's crop when the drag started (zoom and pan). */
    crop?: CropTransform;
    /** Overlay drags: the dragged box and its neighbour as % of the frame, the box centre on screen, and the starting values. */
    snap?: SnapGeometry;
    centre?: { x: number; y: number };
    startDistance?: number;
    origSizes?: number[];
    origScale?: number;
    rect?: DOMRect;
    boardStarts?: Array<{ sizeId: string; x: number; y: number }>;
    moved?: boolean;
  } | null>(null);
  // Double-click a format to reveal the whole picture as a ghost and position it under the crop window.
  const [revealSizeId, setRevealSizeId] = useState<string | null>(null);
  // One frame of a split composition, selected so it can be removed (button or Delete key).
  const [selectedPane, setSelectedPane] = useState<{ sizeId: string; index: number } | null>(null);
  const paneDown = useRef<{ x: number; y: number } | null>(null);
  // A composition grid over the frame (thirds or quarters) to help place things. Never exported.
  const [gridMode, setGridMode] = useState<'off' | '3x3' | '4x4'>('off');
  // A plain drag moves the format on the canvas, like a design tool. Session only: it is where it sits, not part of the edit.
  const [frameOffsets, setFrameOffsets] = useState<Record<string, { x: number; y: number }>>({});
  // The real engine currently exposes neutral default board coordinates on each render.
  // Keep this project's board arrangement stable within the editing session instead of snapping
  // tiles back after every catalogue refresh. Persistence to the project file is a separate change.
  const [boardPlacements, setBoardPlacements] = useState<Record<string, { x: number; y: number }>>({});
  const ignoreBoardClick = useRef(false);
  useEffect(() => {
    if (!revealSizeId) return;
    const leave = (event: KeyboardEvent) => { if (event.key === 'Escape' || event.key === 'Enter') setRevealSizeId(null); };
    window.addEventListener('keydown', leave);
    return () => window.removeEventListener('keydown', leave);
  }, [revealSizeId]);

  if (!photo) {
    return (
      <main className="flex flex-1 items-center justify-center bg-[var(--bg-canvas)] text-sm text-[var(--text-muted)]">
        {STRINGS.canvas.selectPhoto}
      </main>
    );
  }

  const group: EditGroup = getActiveGroup(photo);
  // An individual format may have one, two, or three continuous export frames.
  // Keep the canvas' pane count derived from the SAME saved metadata as exportOps.
  const splitCountFor = (sizeId: string): SplitFrameCount => {
    const split = photo.formatSplits?.[sizeId];
    return !features.splitFrames || !split?.enabled ? 1 : split.count ?? 2;
  };
  /** Add one frame (up to five), or remove one; the composition stays one continuous picture. */
  const changeSplitCount = (sizeId: string, count: number) => {
    if (count < 1 || count > MAX_SPLIT_FRAMES) return;
    if (onSetSplitFrameCount) onSetSplitFrameCount(photo.id, sizeId, count as SplitFrameCount);
    else if ((count > 1) !== splitFor(sizeId)) onToggleSplitFrames(photo.id);
  };
  const splitFor = (sizeId: string) => splitCountFor(sizeId) > 1;
  const splitOffsetFor = (sizeId: string) => photo.formatSplits?.[sizeId]?.offset ?? 0;
  const compareMode = compareRequested && !splitFor(activeSizeId);
  const enabledSizes = photo.sizes.filter((s) => s.enabled);
  const activeSize: SizePreset =
    photo.sizes.find((s) => s.id === activeSizeId) ?? enabledSizes[0] ?? photo.sizes[0];
  const filterCss = buildPreviewFilterCss(group.recipe, hoveredLook);
  const overflowIssues = detectOverlayOverflow(group.overlay, photo, photo.sizes);
  const watermarkPreset =
    watermarkPresets.find((w) => w.id === group.overlay.watermarkPresetId) ?? watermarkPresets[0];
  // 'auto' uses what the engine measured behind the watermark on this photo; until then, light on dark.
  const effectiveContrast =
    group.overlay.watermarkContrast === 'auto' ? photo.watermarkAuto ?? 'light-on-dark' : group.overlay.watermarkContrast;
  const watermarkImage =
    watermarkPreset?.kind === 'image'
      ? effectiveContrast === 'light-on-dark'
        ? watermarkPreset.forDarkUrl ?? watermarkPreset.forLightUrl
        : watermarkPreset.forLightUrl ?? watermarkPreset.forDarkUrl
      : undefined;

  const getFontFamily = (fontId: string) =>
    fonts.find((f) => f.id === fontId)?.family ?? 'var(--font-sans)';

  const buildImageTransform = (crop: CropTransform, extraPanX = 0) => {
    const sx = (crop.flipH ? -1 : 1) * crop.zoom;
    const sy = (crop.flipV ? -1 : 1) * crop.zoom;
    return `translate(${crop.panX + extraPanX}%, ${crop.panY}%) rotate(${crop.rotateDeg}deg) scale(${sx}, ${sy})`;
  };

  const MAX_CROP_ZOOM = 8;
  /** How far the picture can be moved under the crop window (in % of the frame) before its edge shows. */
  const panLimits = (size: SizePreset, zoom: number) =>
    cropPanLimits(photo.pixelSize, size, zoom);

  const handleFramePointerDown = (
    e: React.PointerEvent<HTMLElement>,
    kind: NonNullable<typeof dragRef.current>['kind'],
    size: SizePreset,
    frameEl?: HTMLElement | null
  ) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const rect = frameEl?.getBoundingClientRect();
    let origA = 0;
    let origB = 0;
    if (kind === 'pan') {
      origA = size.crop.panX;
      origB = size.crop.panY;
      setDraggingType('pan');
    } else if (kind === 'split') {
      origA = splitOffsetFor(size.id);
      setDraggingType('pan');
    } else if (kind === 'text') {
      const box = e.currentTarget.getBoundingClientRect();
      origA = rect?.width ? (box.left + box.width / 2 - rect.left) / rect.width * 100 : group.overlay.textX;
      origB = rect?.height ? (box.top + box.height / 2 - rect.top) / rect.height * 100 : group.overlay.textY;
      setDraggingType('text');
    } else if (kind === 'watermark') {
      const box = e.currentTarget.getBoundingClientRect();
      origA = rect?.width ? (box.left + box.width / 2 - rect.left) / rect.width * 100 : group.overlay.watermarkX;
      origB = rect?.height ? (box.top + box.height / 2 - rect.top) / rect.height * 100 : group.overlay.watermarkY;
      setDraggingType('watermark');
    } else if (kind === 'board') {
      origA = size.boardX;
      origB = size.boardY;
      setDraggingType('board');
    } else if (kind.startsWith('scale-')) {
      setDraggingType('crop');
    } else if (kind === 'move-frame') {
      origA = frameOffsets[size.id]?.x ?? 0;
      origB = frameOffsets[size.id]?.y ?? 0;
      setDraggingType('board');
    } else if (kind === 'crop-top') {
      origA = size.crop.insetTop;
      setDraggingType('crop');
    } else if (kind === 'crop-right') {
      origA = size.crop.insetRight;
      setDraggingType('crop');
    } else if (kind === 'crop-bottom') {
      origA = size.crop.insetBottom;
      setDraggingType('crop');
    } else if (kind === 'crop-left') {
      origA = size.crop.insetLeft;
      setDraggingType('crop');
    }

    // Overlay drags and resizes: measure the box now (it does not move while the pointer is down).
    let snap: SnapGeometry | undefined;
    let centre: { x: number; y: number } | undefined;
    let startDistance: number | undefined;
    let origSizes: number[] | undefined;
    let origScale: number | undefined;
    if ((kind === 'text' || kind === 'watermark' || kind === 'resize-text' || kind === 'resize-watermark') && rect) {
      const own = ((e.currentTarget as HTMLElement).closest('[data-overlay]') as HTMLElement | null)?.getBoundingClientRect();
      const ownKind = kind === 'text' || kind === 'resize-text' ? 'text' : 'watermark';
      const peerEl = frameEl?.querySelector(`[data-overlay="${ownKind === 'text' ? 'watermark' : 'text'}"]`) as HTMLElement | null;
      const peerRect = peerEl?.getBoundingClientRect();
      const pct = (value: number, origin: number, span: number) => ((value - origin) / span) * 100;
      if (own) {
        const rowSize = group.overlay.rows[0]?.sizePx ?? 14;
        // A quarter of one text row's height is the space left between overlays, in % of the frame's height and width.
        const rowHeightPercent = (rowSize / 660) * 100 * (rect.width / rect.height) * 1.375;
        snap = {
          box: { w: (own.width / rect.width) * 100, h: (own.height / rect.height) * 100 },
          peer: peerRect ? { left: pct(peerRect.left, rect.left, rect.width), right: pct(peerRect.right, rect.left, rect.width), top: pct(peerRect.top, rect.top, rect.height), bottom: pct(peerRect.bottom, rect.top, rect.height) } : null,
          gap: { x: (rowHeightPercent * 0.25) * (rect.height / rect.width), y: rowHeightPercent * 0.25 },
        };
        centre = { x: own.left + own.width / 2, y: own.top + own.height / 2 };
        startDistance = Math.max(8, Math.hypot(e.clientX - centre.x, e.clientY - centre.y));
      }
      origSizes = group.overlay.rows.map((row) => row.sizePx);
      origScale = group.overlay.watermarkScale;
      setDraggingType(ownKind);
    }

    dragRef.current = {
      kind,
      snap,
      centre,
      startDistance,
      origSizes,
      origScale,
      sizeId: size.id,
      startX: e.clientX,
      startY: e.clientY,
      origA,
      origB,
      crop: size.crop,
      rect,
    };
  };

  const handleArtboardPointerDown = (e: React.PointerEvent<HTMLElement>, size: SizePreset) => {
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
    // On a board, dragging an already-selected tile moves the whole selection together.
    const targets = selectedSizeIds.includes(size.id) ? selectedSizeIds : [size.id];
    if (!selectedSizeIds.includes(size.id)) onSelectSize(size.id);
    handleFramePointerDown(e, 'board', size);
    if (dragRef.current) {
      dragRef.current.boardStarts = targets.flatMap((sizeId) => {
        const current = photo.sizes.find((item) => item.id === sizeId);
        if (!current) return [];
        const pos = boardPlacements[`${photo.id}:${sizeId}`] ?? { x: current.boardX, y: current.boardY };
        return [{ sizeId, ...pos }];
      });
    }
  };

  const handleArtboardClick = (e: React.MouseEvent<HTMLElement>, sizeId: string) => {
    e.stopPropagation();
    if (ignoreBoardClick.current) { ignoreBoardClick.current = false; return; }
    onSelectSize(sizeId, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, available: enabledSizes.map((size) => size.id) });
  };

  const handleGlobalPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const width = drag.rect?.width || 460;
    const height = drag.rect?.height || 320;

    if (drag.kind === 'pan') {
      // Move the picture under the crop window: 100% of the frame is 100 units, and it can go as far as the picture reaches.
      const limits = panLimits(photo.sizes.find((size) => size.id === drag.sizeId) ?? activeSize, drag.crop?.zoom ?? 1);
      onUpdateCrop(photo.id, drag.sizeId, {
        panX: Math.round(clamp(drag.origA + (dx / width) * 100, -limits.x, limits.x)),
        panY: Math.round(clamp(drag.origB + (dy / height) * 100, -limits.y, limits.y)),
      });
    } else if (drag.kind === 'move-frame') {
      setFrameOffsets((current) => ({ ...current, [drag.sizeId]: { x: drag.origA + dx / canvasZoom, y: drag.origB + dy / canvasZoom } }));
    } else if (drag.kind.startsWith('scale-') && drag.crop) {
      // Aspect-locked crop: pulling the image bounds out zooms in, and pushing inward zooms out.
      // The opposite edge/corner remains the anchor, and zoom never drops below fit.
      const side = drag.kind.slice('scale-'.length) as CropHandleSide;
      // Handles sit on the IMAGE bounds: pulling outward must enlarge the
      // image; the former inward-positive maths inverted every corner/edge.
      const zoom = cropHandleZoom(side, dx, dy, width, height, drag.crop.zoom, MAX_CROP_ZOOM);
      const anchors: Record<string, [number, number]> = { top: [0, 0.5], bottom: [0, -0.5], left: [0.5, 0], right: [-0.5, 0], tl: [0.5, 0.5], tr: [-0.5, 0.5], bl: [0.5, -0.5], br: [-0.5, -0.5] };
      const [ax, ay] = anchors[side] ?? [0, 0];
      const limits = panLimits(photo.sizes.find((size) => size.id === drag.sizeId) ?? activeSize, zoom);
      onUpdateCrop(photo.id, drag.sizeId, {
        zoom: Number(zoom.toFixed(2)),
        panX: Math.round(clamp(drag.crop.panX + (drag.crop.zoom - zoom) * ax * 100, -limits.x, limits.x)),
        panY: Math.round(clamp(drag.crop.panY + (drag.crop.zoom - zoom) * ay * 100, -limits.y, limits.y)),
      });
    } else if (drag.kind === 'split') {
      onSetSplitPanOffset(photo.id, Math.round(clamp(drag.origA + (dx / width) * 60, -25, 25)));
    } else if (drag.kind === 'board') {
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      const updates = (drag.boardStarts ?? []).map(({ sizeId, x, y }) => ({
        sizeId, x: x + dx / canvasZoom, y: y + dy / canvasZoom,
      }));
      setBoardPlacements((prior) => {
        const next = { ...prior };
        for (const item of updates) next[`${photo.id}:${item.sizeId}`] = { x: item.x, y: item.y };
        return next;
      });
      for (const item of updates) onMoveArtboard(photo.id, item.sizeId, item.x, item.y);
    } else if (drag.kind === 'crop-top') {
      onUpdateCrop(photo.id, drag.sizeId, {
        insetTop: Math.round(clamp(drag.origA + (dy / height) * 100, 0, 30)),
      });
    } else if (drag.kind === 'crop-bottom') {
      onUpdateCrop(photo.id, drag.sizeId, {
        insetBottom: Math.round(clamp(drag.origA - (dy / height) * 100, 0, 30)),
      });
    } else if (drag.kind === 'crop-left') {
      onUpdateCrop(photo.id, drag.sizeId, {
        insetLeft: Math.round(clamp(drag.origA + (dx / width) * 100, 0, 30)),
      });
    } else if (drag.kind === 'crop-right') {
      onUpdateCrop(photo.id, drag.sizeId, {
        insetRight: Math.round(clamp(drag.origA - (dx / width) * 100, 0, 30)),
      });
    } else if (drag.kind === 'text') {
      const rawX = drag.origA + (dx / width) * 100;
      const rawY = drag.origB + (dy / height) * 100;
      const snapped = snapOverlayPosition(
        rawX,
        rawY,
        {
          x: group.overlay.watermarkX,
          y: group.overlay.watermarkY,
          visible: group.overlay.watermarkEnabled,
        },
        group.overlay.snapEnabled,
        undefined,
        drag.snap
      );
      setActiveGuides(snapped.guides);
      // Dragging an anchored box frees it: from now on it stays where it is dropped (still inside the margins).
      onUpdateOverlay(photo.id, { textX: snapped.x, textY: snapped.y, textPlacement: 'free' });
    } else if (drag.kind === 'watermark') {
      const rawX = drag.origA + (dx / width) * 100;
      const rawY = drag.origB + (dy / height) * 100;
      const snapped = snapOverlayPosition(
        rawX,
        rawY,
        {
          x: group.overlay.textX,
          y: group.overlay.textY,
          visible: group.overlay.textEnabled,
        },
        group.overlay.snapEnabled,
        undefined,
        drag.snap
      );
      setActiveGuides(snapped.guides);
      onUpdateOverlay(photo.id, { watermarkX: snapped.x, watermarkY: snapped.y, watermarkPlacement: 'free' });
    } else if ((drag.kind === 'resize-text' || drag.kind === 'resize-watermark') && drag.centre && drag.startDistance) {
      // Corner handles scale the overlay in proportion: how far the pointer is from the box centre, against where it began.
      const ratio = Math.hypot(e.clientX - drag.centre.x, e.clientY - drag.centre.y) / drag.startDistance;
      if (drag.kind === 'resize-text' && drag.origSizes) {
        // The text never grows past the frame: each row stops at the size its words still fit.
        onUpdateOverlay(photo.id, { rows: group.overlay.rows.map((row, index) => ({ ...row, sizePx: Math.round(clamp((drag.origSizes![index] ?? row.sizePx) * ratio, 8, maxRowSizePx(row, photo, group.overlay))) })) });
      } else if (drag.kind === 'resize-watermark' && drag.origScale) {
        onUpdateOverlay(photo.id, { watermarkScale: Math.round(clamp(drag.origScale * ratio, 40, 160)) });
      }
    }
  };

  /** Press and hold one finger on the photo (still, about half a second) to see the original; let go to see the edit again. */
  const endHold = () => {
    if (holdRef.current.timer !== null) window.clearTimeout(holdRef.current.timer);
    holdRef.current = { timer: null, x: 0, y: 0, active: false };
    setHoldingOriginal(false);
  };

  /** The single photo frame. A pinch can start with a finger in the margin round it, so crop maths always measure the
   * frame itself rather than whichever element received the touch. */
  const frameElement = (fallback: HTMLElement) =>
    (stageRef.current?.querySelector('[data-testid="canvas-frame"]') as HTMLElement | null) ?? fallback;

  /** `fromMargin`: the finger landed in the empty stage round the photo, not on it. It still pinches, pans and swipes the
   * view, but it never starts positioning the picture in Crop mode. */
  const handleTouchDown = (e: React.PointerEvent<HTMLElement>, fromMargin = false) => {
    if (e.pointerType !== 'touch' || activeSize.kind !== 'photo' || compareMode) return false;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    touchPoints.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPoints.current.size === 2) {
      const [a, b] = [...touchPoints.current.values()];
      const centreX = (a.x + b.x) / 2, centreY = (a.y + b.y) / 2;
      const editingCrop = revealSizeId === activeSize.id;
      touchGesture.current = {
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        zoom: editingCrop ? activeSize.crop.zoom : zoomRef.current,
        panX: activeSize.crop.panX, panY: activeSize.crop.panY,
        centreX, centreY, lastCentreX: centreX, lastCentreY: centreY,
      };
      dragRef.current = null;
      touchPan.current = null;
      endHold();
      if (swipeRef.current) swipeRef.current.pinched = true;
    } else if (touchPoints.current.size === 1) {
      // A touch outside explicit Crop mode is navigation ONLY: never write into the export recipe.
      if (revealSizeId === activeSize.id && !fromMargin) handleFramePointerDown(e, 'pan', activeSize, frameElement(e.currentTarget));
      touchPan.current = { x: e.clientX, y: e.clientY };
      swipeRef.current = { x: e.clientX, y: e.clientY, t: performance.now(), pinched: false };
      endHold();
      holdRef.current.x = e.clientX; holdRef.current.y = e.clientY;
      holdRef.current.timer = window.setTimeout(() => {
        holdRef.current.timer = null;
        if (touchPoints.current.size !== 1) return;
        holdRef.current.active = true;
        dragRef.current = null; setDraggingType('none'); // the hold is not a pan
        setHoldingOriginal(true);
        try { navigator.vibrate?.(10); } catch { /* haptics are optional */ }
      }, 450);
    }
    return true;
  };
  const handleTouchMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!touchPoints.current.has(e.pointerId)) return false;
    if (holdRef.current.active) return true; // holding to look at the original: do not move the picture
    if (holdRef.current.timer !== null && Math.hypot(e.clientX - holdRef.current.x, e.clientY - holdRef.current.y) > 8) {
      window.clearTimeout(holdRef.current.timer); holdRef.current.timer = null;
    }
    touchPoints.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPoints.current.size === 2 && touchGesture.current) {
      const [a, b] = [...touchPoints.current.values()];
      const start = touchGesture.current;
      const centreX = (a.x + b.x) / 2;
      const centreY = (a.y + b.y) / 2;
      if (revealSizeId === activeSize.id) {
        // Only explicit Crop mode is permitted to change the saved image transformation.
        const zoom = clamp(start.zoom * Math.hypot(a.x - b.x, a.y - b.y) / start.distance, 1, MAX_CROP_ZOOM);
        const rect = frameElement(e.currentTarget).getBoundingClientRect();
        const focalX = (start.centreX - rect.left) / Math.max(1, rect.width) - 0.5;
        const focalY = (start.centreY - rect.top) / Math.max(1, rect.height) - 0.5;
        const limits = panLimits(activeSize, zoom);
        onUpdateCrop(photo.id, activeSize.id, {
          zoom: Number(zoom.toFixed(3)),
          panX: clamp(start.panX + (centreX - start.centreX) / Math.max(1, rect.width) * 100 + (start.zoom - zoom) * focalX * 100, -limits.x, limits.x),
          panY: clamp(start.panY + (centreY - start.centreY) / Math.max(1, rect.height) * 100 + (start.zoom - zoom) * focalY * 100, -limits.y, limits.y),
        });
      } else {
        // Pinch-to-view with a stable focal point. Move the scrollable *viewport* rather
        // than the photo, so the fitted crop/export stay byte-for-byte unchanged.
        const stage = stageRef.current;
        if (stage) {
          const next = clamp(start.zoom * Math.hypot(a.x - b.x, a.y - b.y) / start.distance, 0.25, 8);
          stage.scrollLeft -= centreX - start.lastCentreX;
          stage.scrollTop -= centreY - start.lastCentreY;
          start.lastCentreX = centreX;
          start.lastCentreY = centreY;
          if (Math.abs(next - zoomRef.current) > 0.002) {
            const rect = stage.getBoundingClientRect();
            zoomAnchor.current = {
              x: centreX - rect.left, y: centreY - rect.top,
              left: stage.scrollLeft, top: stage.scrollTop, zoom: zoomRef.current,
            };
            zoomRef.current = next;
            setZoomRef.current(next);
          }
        }
      }
    } else if (touchPoints.current.size === 1) {
      if (revealSizeId === activeSize.id) {
        handleGlobalPointerMove(e);
      } else {
        const previous = touchPan.current;
        const stage = stageRef.current;
        if (previous && stage && zoomRef.current > 1.01) {
          stage.scrollLeft -= e.clientX - previous.x;
          stage.scrollTop -= e.clientY - previous.y;
        }
        touchPan.current = { x: e.clientX, y: e.clientY };
      }
    }
    return true;
  };
  const handleTouchEnd = (e: React.PointerEvent<HTMLElement>) => {
    if (!touchPoints.current.delete(e.pointerId)) return false;
    const heldOriginal = holdRef.current.active;
    endHold();
    // A clean one-finger flick on an unzoomed photo steps through photos (left/right) or formats (up/down). A pinch, a hold,
    // crop positioning or a zoomed picture (where a drag moves the picture) never counts.
    const swipe = swipeRef.current;
    if (touchPoints.current.size === 0) {
      swipeRef.current = null;
      if (swipe && !swipe.pinched && !heldOriginal && revealSizeId !== activeSize.id && zoomRef.current <= 1.01) {
        const intent = swipeIntent(e.clientX - swipe.x, e.clientY - swipe.y, performance.now() - swipe.t);
        if (intent === 'next-photo') onStepPhoto?.(1);
        else if (intent === 'previous-photo') onStepPhoto?.(-1);
        else if (intent === 'next-format' || intent === 'previous-format') {
          const next = stepFrom(photo.sizes.filter((size) => size.kind === 'photo' && size.enabled), activeSize.id, intent === 'next-format' ? 1 : -1);
          if (next) onSelectSize(next.id);
        }
      }
    }
    touchGesture.current = null;
    handleGlobalPointerUp();
    if (touchPoints.current.size === 1) {
      const [, point] = [...touchPoints.current.entries()][0];
      touchPan.current = { x: point.x, y: point.y };
      if (revealSizeId === activeSize.id) {
        dragRef.current = {
          kind: 'pan', sizeId: activeSize.id, startX: point.x, startY: point.y,
          origA: activeSize.crop.panX, origB: activeSize.crop.panY, crop: activeSize.crop,
          rect: frameElement(e.currentTarget).getBoundingClientRect(),
        };
      }
    } else {
      touchPan.current = null;
    }
    return true;
  };
  /** A cancelled touch (the browser interrupted it - an edge gesture, an alert, losing focus) is not a finger lift:
   * treating it like `handleTouchEnd` would start a fresh one-finger pan from whichever touch happens to remain
   * tracked, continuing a gesture the person never intended to continue. Clear everything instead. */
  const handleTouchCancel = (e: React.PointerEvent<HTMLElement>) => {
    if (!touchPoints.current.has(e.pointerId)) return false;
    endHold();
    swipeRef.current = null;
    touchPoints.current.clear();
    touchGesture.current = null;
    touchPan.current = null;
    dragRef.current = null;
    setDraggingType('none');
    setActiveGuides([]);
    return true;
  };

  const handleGlobalPointerUp = () => {
    if (!dragRef.current) return;
    if (dragRef.current.kind === 'board' && dragRef.current.moved) {
      ignoreBoardClick.current = true;
      // The click generated by this same pointer-up may still fire. Do not suppress
      // a later, intentional click after the drag has finished.
      window.setTimeout(() => { ignoreBoardClick.current = false; }, 0);
    }
    dragRef.current = null;
    setDraggingType('none');
    setActiveGuides([]);
  };

  // The empty stage round the photo. On touch it takes the same pinch, pan and swipe as the photo, so a pinch that starts
  // in the margin zooms the photo instead of the page. With a mouse or pen, dragging it moves round a zoomed-in photo,
  // as one finger does on a tablet. Controls, overlays, the photo frame and the All formats cards keep their own gestures.
  const stageGestures = canvasLayoutMode === 'single' && activeSize.kind === 'photo' && !compareMode && !splitFor(activeSize.id);
  const isStageMargin = (e: React.PointerEvent<HTMLElement>) => {
    const target = e.target as Element | null;
    if (!target || target === e.currentTarget) return true;
    if (!target.closest('[data-stage-margin]')) return false;
    return !target.closest('button, a, input, select, textarea, [role="slider"], [data-overlay], [data-testid="canvas-frame"]');
  };
  const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!stageGestures || !isStageMargin(e)) return;
    if (e.pointerType === 'touch') { handleTouchDown(e, true); return; }
    const stage = e.currentTarget;
    if (e.button !== 0 || (stage.scrollWidth <= stage.clientWidth + 1 && stage.scrollHeight <= stage.clientHeight + 1)) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    marginPan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    setMarginPanning(true);
  };
  const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      if (touchPoints.current.has(e.pointerId)) { e.stopPropagation(); handleTouchMove(e); }
      return;
    }
    const pan = marginPan.current;
    if (!pan || pan.id !== e.pointerId) return;
    e.stopPropagation();
    e.currentTarget.scrollLeft = pan.left - (e.clientX - pan.x);
    e.currentTarget.scrollTop = pan.top - (e.clientY - pan.y);
  };
  const handleStagePointerEnd = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (e.pointerType === 'touch') {
      if (touchPoints.current.has(e.pointerId)) { e.stopPropagation(); if (cancelled) handleTouchCancel(e); else handleTouchEnd(e); }
      return;
    }
    if (marginPan.current?.id !== e.pointerId) return;
    e.stopPropagation();
    marginPan.current = null;
    setMarginPanning(false);
  };

  const handleVideoPinDrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeSize.kind !== 'video' || !features.zoomVideo) return;
    if (draggingType !== 'none') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(clamp(((e.clientX - rect.left) / rect.width) * 100, 8, 92));
    const y = Math.round(clamp(((e.clientY - rect.top) / rect.height) * 100, 8, 92));
    onUpdateVideoZoom(photo.id, { enabled: true, focalX: x, focalY: y });
  };

  // Overlay sizes are a share of the frame's width, so they look the same in every format and at every zoom, in the
  // working area, on the All formats board, and in the export. The number the person sets (the size slider) is the size in
  // pixels on a frame 660 wide (the single view of a landscape photo), turned into container-query width units.
  const REFERENCE_FRAME_WIDTH = 660;
  const cqw = (px: number) => `${(px / REFERENCE_FRAME_WIDTH) * 100}cqw`;

  const renderOverlaysInsideFrame = (size: SizePreset, interactive: boolean) => {
    const overlay = group.overlay;
    return (
      <div className="pointer-events-none absolute inset-0 z-20" style={{ containerType: 'size' }} data-testid="overlay-layer">
        {/* Magnetic snap guide lines while dragging text or watermark */}
        {interactive &&
          activeGuides.map((guide, idx) =>
            guide.axis === 'x' ? (
              <div
                key={`gx-${idx}`}
                className="pointer-events-none absolute inset-y-0 z-30 border-l border-dashed border-[var(--brand-accent)]"
                style={{ left: `${guide.percent}%` }}
              >
                <span className="absolute top-2 left-1.5 rounded bg-[var(--brand-accent)] px-1.5 py-0.5 text-[0.5625rem] font-semibold text-[var(--text-on-accent)] whitespace-nowrap">
                  {guide.label}
                </span>
              </div>
            ) : (
              <div
                key={`gy-${idx}`}
                className="pointer-events-none absolute inset-x-0 z-30 border-t border-dashed border-[var(--brand-accent)]"
                style={{ top: `${guide.percent}%` }}
              >
                <span className="absolute right-2 -top-5 rounded bg-[var(--brand-accent)] px-1.5 py-0.5 text-[0.5625rem] font-semibold text-[var(--text-on-accent)] whitespace-nowrap">
                  {guide.label}
                </span>
              </div>
            )
          )}

        {(() => {
          // Text and watermark are laid out by the rule in overlayLayout.ts, the same one the export uses. An anchored box
          // sits at the edge margin of its place; two boxes at the same place stack (watermark above the text).
          const showText = overlay.textEnabled && features.overlayText && overlay.rows.some((row) => !!formatOverlayRowText(row, photo));
          const showMark = overlay.watermarkEnabled && features.watermarkCustom && !!watermarkPreset;
          const cover = overlay.textLayoutMode === 'cover-full';
          const layer = (target: EventTarget) => (target as HTMLElement).closest('[data-testid="overlay-layer"]') as HTMLElement | null;
          const resizeHandles = (which: 'resize-text' | 'resize-watermark', label: string) => interactive && (
            <>
              {(['top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize', 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize', 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize', 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize'] as const).map((place) => (
                <button
                  key={place}
                  type="button"
                  aria-label={label}
                  onPointerDown={(e) => handleFramePointerDown(e, which, size, layer(e.currentTarget))}
                  className={`pointer-events-auto absolute z-30 h-2.5 w-2.5 rounded-sm border border-white bg-[var(--brand-accent)] opacity-0 shadow hover:opacity-100 group-hover/overlay:opacity-100 focus-visible:opacity-100 ${place}`}
                />
              ))}
            </>
          );
          const textColour = overlay.textColour === 'light' ? '#F8F6F2' : '#14171F';
          const textNode = (extra: React.CSSProperties) => (
            <div
              onPointerDown={interactive && !cover ? (e) => handleFramePointerDown(e, 'text', size, layer(e.currentTarget)) : undefined}
              data-overlay="text"
              data-artwork
              title={interactive && !cover ? STRINGS.overlayKit.dragText : undefined}
              className={`group/overlay relative z-20 shrink-0 select-none rounded-[var(--radius-sm)] ${interactive && !cover ? 'pointer-events-auto cursor-move ring-1 ring-transparent hover:ring-[var(--brand-accent)]' : 'pointer-events-none'}`}
              style={{
                padding: `${cqw(8)} ${cqw(12)}`,
                textAlign: overlay.textAlign,
                backgroundColor: overlay.textScrim ? (overlay.textColour === 'light' ? 'rgba(10, 12, 16, 0.62)' : 'rgba(246, 244, 238, 0.72)') : 'transparent',
                color: textColour,
                ...extra,
              }}
            >
              {resizeHandles('resize-text', STRINGS.canvas.resizeText)}
              {overlay.rows.map((row) => {
                // A row with nothing to say takes no room, here or in the export.
                const words = formatOverlayRowText(row, photo);
                return words ? (
                  <p key={row.id} className="leading-snug whitespace-nowrap" style={{ fontFamily: getFontFamily(row.fontId), fontSize: cqw(row.sizePx), fontWeight: row.weight, letterSpacing: cqw(row.letterSpacing) }}>
                    {words}
                  </p>
                ) : null;
              })}
            </div>
          );
          const s = overlay.watermarkScale / 100;
          const markAlign = overlay.watermarkPlacement === 'anchor' ? alignForAnchor(overlay.watermarkPosition) : 'center';
          const markNode = (extra: React.CSSProperties) => watermarkPreset && (
            <div
              onPointerDown={interactive ? (e) => handleFramePointerDown(e, 'watermark', size, layer(e.currentTarget)) : undefined}
              data-overlay="watermark"
              data-artwork
              title={interactive ? STRINGS.overlayKit.dragWatermark : undefined}
              className={`group/overlay relative z-20 shrink-0 select-none rounded ${interactive ? 'pointer-events-auto cursor-move ring-1 ring-transparent hover:ring-[var(--brand-accent)]' : 'pointer-events-none'}`}
              style={{
                padding: `${cqw(4 * s)} ${cqw(10 * s)}`,
                textAlign: markAlign,
                opacity: overlay.watermarkOpacity / 100,
                color: effectiveContrast === 'light-on-dark' ? '#F8F6F2' : '#14171F',
                backgroundColor: watermarkImage ? 'transparent' : effectiveContrast === 'light-on-dark' ? 'rgba(9, 11, 15, 0.36)' : 'rgba(248, 246, 242, 0.54)',
                ...extra,
              }}
            >
              {resizeHandles('resize-watermark', STRINGS.canvas.resizeWatermark)}
              {watermarkImage ? (
                <img src={watermarkImage} alt={watermarkPreset.label} draggable={false} className="block w-auto object-contain" style={{ height: cqw(36 * s), maxWidth: cqw(180 * s) }} />
              ) : (
                <p className="font-bold whitespace-nowrap" style={{ fontSize: cqw(11 * s), lineHeight: 1.5, letterSpacing: '0.14em' }}>{watermarkPreset.text}</p>
              )}
              {!watermarkImage && watermarkPreset.subtext && (
                <p className="opacity-80 whitespace-nowrap" style={{ fontSize: cqw(9 * s), lineHeight: 1.5, letterSpacing: '0.18em' }}>{watermarkPreset.subtext}</p>
              )}
            </div>
          );
          const margin = cqw((overlay.edgeMargin / 100) * REFERENCE_FRAME_WIDTH);
          const anchored = (anchor: OverlaySettings['textPosition'], children: React.ReactNode, key: string) => (
            <div key={key} className="pointer-events-none absolute inset-0 flex flex-col" style={{ ...anchorFlexStyle(anchor, margin), gap: cqw(STACK_GAP_PX) }}>{children}</div>
          );
          const free = (x: number, y: number) => ({ position: 'absolute' as const, left: `${x}%`, top: `${y}%`, transform: freeTransform(x, y, overlay.edgeMargin) });
          const parts: React.ReactNode[] = [];
          if (showText && cover) {
            parts.push(
              <div key="cover" data-overlay="text" data-artwork className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center text-center" style={{ padding: cqw(24), backgroundColor: overlay.textScrim ? (overlay.textColour === 'light' ? 'rgba(10, 12, 16, 0.48)' : 'rgba(246, 244, 238, 0.56)') : 'transparent', color: textColour }}>
                {overlay.rows.map((row) => { const words = formatOverlayRowText(row, photo); return words ? <p key={row.id} className="leading-snug whitespace-nowrap" style={{ fontFamily: getFontFamily(row.fontId), fontSize: cqw(row.sizePx), fontWeight: row.weight, letterSpacing: cqw(row.letterSpacing) }}>{words}</p> : null; })}
              </div>
            );
          }
          if (showText && !cover && showMark && stacked(overlay, true)) {
            parts.push(anchored(overlay.textPosition, <>{markNode({})}{textNode({})}</>, 'stack'));
            return parts;
          }
          if (showText && !cover) parts.push(overlay.textPlacement === 'anchor' ? anchored(overlay.textPosition, textNode({}), 'text') : <React.Fragment key="text">{textNode(free(overlay.textX, overlay.textY))}</React.Fragment>);
          if (showMark) parts.push(overlay.watermarkPlacement === 'anchor' ? anchored(overlay.watermarkPosition, markNode({}), 'mark') : <React.Fragment key="mark">{markNode(free(overlay.watermarkX, overlay.watermarkY))}</React.Fragment>);
          return parts;
        })()}
      </div>
    );
  };

  /** The photo as pixels: the engine's renderer when there is one, otherwise a plain image with the CSS approximation. */
  // The selected mask (its layer is open in the Masks panel). Oval and gradient masks also get an outline with handles.
  const selectedMask = maskGuideId ? photo.masks.find((layer) => layer.id === maskGuideId && layer.visible) : undefined;
  const selectedShape = selectedMask?.geometry ? { ...selectedMask, geometry: selectedMask.geometry } : undefined;
  const renderMaskOutline = selectedShape && onSetMaskGeometry
    ? (picture: { width: number; height: number }) => (
      <MaskOutlineLayer picture={picture} name={selectedShape.name} geometry={selectedShape.geometry} feather={selectedShape.feather}
        onChange={(field, value) => onSetMaskGeometry(photo.id, selectedShape.id, field, value)} />
    ) : undefined;
  const renderSurface = (variant: 'edited' | 'original', alt: string, style: React.CSSProperties, filter: string) =>
    PhotoSurface ? (
      <PhotoSurface photoId={photo.id} variant={variant}
        maskGuideId={variant === 'edited' && alt && !compareMode && maskOverlayVisible ? maskGuideId : undefined}
        maskOutline={variant === 'edited' && alt && !compareMode ? renderMaskOutline : undefined}
        lookPreview={variant === 'edited' ? hoveredLook?.recipeDelta : undefined} alt={alt} className="h-full w-full" style={style} />
    ) : (
      <img src={photo.previewUrl} alt={alt} referrerPolicy="no-referrer" draggable={false}
        className="h-full w-full object-cover" style={{ ...style, filter }} />
    );

  /** One wide picture behind split frames. Through the engine's surface, like the single view, so a RAW keeps showing
   * once its developed picture replaces the embedded preview: a plain <img> of `photo.previewUrl` kept the old blob
   * address after it was released, and every frame showed a broken image (owner report, 24 Nov 2026). */
  const renderStrip = (alt: string, className: string, style: React.CSSProperties) =>
    PhotoSurface ? (
      <PhotoSurface photoId={photo.id} variant="edited" alt={alt} className={className} style={style} />
    ) : (
      <img src={photo.previewUrl} alt={alt} referrerPolicy="no-referrer" draggable={false}
        className={className} style={{ ...style, filter: compareMode ? 'none' : filterCss }} />
    );

  /** Border claims space WITHIN the output size, without hiding photo pixels.
   * CSS percentage padding resolves against the frame width on all four sides,
   * matching the export layout's per-width border geometry. */
  const inBorderFrame = (size: SizePreset, content: React.ReactNode) => {
    const rawPercent = Math.max(0, Math.min(10, size.crop.borderWidth ?? 0));
    const percent = Math.min(rawPercent, (size.height / Math.max(1, size.width)) * 49);
    const placement = size.crop.borderPlacement ?? 'all';
    const horizontal = placement === 'all' || placement === 'horizontal';
    const vertical = placement === 'all' || placement === 'vertical';
    const padding = placement === 'auto' ? 0 : `${horizontal ? percent : 0}% ${vertical ? percent : 0}%`;
    return (
      <div
        data-testid="image-inside-border"
        className="absolute inset-0 box-border"
        style={{ backgroundColor: percent > 0 || placement === 'auto' ? size.crop.borderColour ?? '#ffffff' : undefined, padding }}
      >
        <div className={`h-full w-full overflow-hidden ${placement === 'auto' ? '[&_img]:object-contain' : ''}`}>{content}</div>
      </div>
    );
  };

  /** The artboard on screen, in pixels, at Fit. */
  const artboardFrame = (size: SizePreset) => {
    const aspect = size.width / Math.max(1, size.height);
    const maxW = aspect >= 1 ? 660 : 420;
    const maxH = 470;
    const availableWidth = Math.max(80, stageSize.width - 32);
    const availableHeight = Math.max(80, stageSize.height - 105);
    const frameW = Math.min(maxW, Math.round(maxH * aspect), availableWidth, availableHeight * aspect);
    return { frameW, frameH: Math.round(frameW / aspect) };
  };
  // Screen pixels the frame uses for one picture pixel at Fit (the picture covers the frame). Null when the size is unknown.
  const fitScale = (() => {
    if (!photo.pixelSize) return null;
    const { frameW, frameH } = artboardFrame(activeSize);
    return Math.max(frameW / photo.pixelSize.width, frameH / photo.pixelSize.height);
  })();
  // Match the export's source cap and device-bounded upscale admission.
  const pixelLimit = maxCanvasPixels(typeof navigator === 'undefined' ? { userAgent: '' } : navigator);
  // Original follows the Output scale (2× doubles it), as its export does; a fixed-size format keeps its size and the
  // scale only lets the picture fill it.
  const chosenScale = activeSize.kind === 'photo' ? group.recipe.upscaleFactor : 1;
  const requestedSize = activeSize.id === ORIGINAL_FORMAT_ID && (chosenScale === 2 || chosenScale === 4)
    ? { ...activeSize, width: activeSize.width * chosenScale, height: activeSize.height * chosenScale } : activeSize;
  const output = effectiveUpscaleOutputSize(requestedSize, photo.pixelSize, chosenScale, pixelLimit);
  const actualPercent = fitScale ? Math.round(fitScale * canvasZoom * 100) : Math.round(canvasZoom * 100);
  const pastPreview = Boolean(photo.cloudPreview) && actualPercent > 100;
  const toggleActualSize = () => {
    if (!fitScale) { onSetZoom(1); return; }
    onSetZoom(Math.abs(actualPercent - 100) <= 1 ? 1 : 1 / fitScale);
  };
  const zoomAroundCentre = (next: number) => {
    const stage = stageRef.current;
    if (stage) zoomAnchor.current = { x: stage.clientWidth / 2, y: stage.clientHeight / 2, left: stage.scrollLeft, top: stage.scrollTop, zoom: canvasZoom };
    onSetZoom(next);
  };
  const zoomToEye = async () => {
    const stage = stageRef.current;
    const frame = stage?.querySelector('[data-testid="canvas-frame"]');
    if (!stage || !frame) return;
    setEyeNote({ text: STRINGS.canvas.eyeLooking, busy: true });
    const outcome = await findEyeOnScreen(frame);
    if (outcome.kind !== 'found') {
      setEyeNote({ text: outcome.kind === 'none' ? STRINGS.canvas.eyeNone : STRINGS.canvas.eyeUnavailable, busy: false });
      return;
    }
    const frameRect = frame.getBoundingClientRect();
    if (!(frameRect.width > 0 && frameRect.height > 0)) return;
    const point = { fx: clamp((outcome.clientX - frameRect.left) / frameRect.width, 0, 1), fy: clamp((outcome.clientY - frameRect.top) / frameRect.height, 0, 1) };
    // 100% (one picture pixel per screen pixel) is the honest view for checking detail; at least 2× when the size is unknown.
    const target = Math.min(16, Math.max(fitScale ? 1 / fitScale : 2, canvasZoom * 1.0001));
    setEyeNote({ text: outcome.confidence === 'likely' ? STRINGS.canvas.eyeFound : STRINGS.canvas.eyeMaybe, busy: false });
    centreOn.current = point;
    setEyeTarget((count) => count + 1);
    if (Math.abs(target - canvasZoom) >= 0.001) onSetZoom(target);
  };

  const renderSingleArtboard = () => {
    const aspect = activeSize.width / Math.max(1, activeSize.height);
    const { frameW, frameH } = artboardFrame(activeSize);
    const revealing = revealSizeId === activeSize.id;
    // The whole picture, at its real shape and the crop's zoom, for the ghost shown round the crop window while positioning.
    const imageAspect = photo.pixelSize ? photo.pixelSize.width / photo.pixelSize.height : 3 / 2;
    const ghost = imageAspect > frameW / frameH
      ? { height: frameH * activeSize.crop.zoom, width: frameH * activeSize.crop.zoom * imageAspect }
      : { width: frameW * activeSize.crop.zoom, height: (frameW * activeSize.crop.zoom) / imageAspect };
    const offset = frameOffsets[activeSize.id];

    const cropClip = `inset(${activeSize.crop.insetTop}% ${activeSize.crop.insetRight}% ${activeSize.crop.insetBottom}% ${activeSize.crop.insetLeft}%)`;

    // Keep the entire split composition visible while editing its shared crop.
    // Previously entering crop mode dropped back to one frame and hid the other.
    if (splitFor(activeSize.id)) {
      // Each pane retains the selected format's full aspect ratio. Fit all two or
      // three panes plus their gaps into the stage without hiding the last one.
      const sectionCount = splitCountFor(activeSize.id);
      const splitWidthBudget = stageSize.width > 0
        ? Math.max(1, ((stageSize.width - 32) / Math.max(0.01, canvasZoom) - 16 * (sectionCount - 1) - (sectionCount < MAX_SPLIT_FRAMES ? 56 : 0)) / sectionCount)
        : frameW;
      const splitFrameW = Math.min(frameW, splitWidthBudget);
      const splitFrameH = splitFrameW / aspect;
      const paneSelected = (paneIdx: number) => selectedPane?.sizeId === activeSize.id && selectedPane.index === paneIdx;
      const removePane = () => { setSelectedPane(null); changeSplitCount(activeSize.id, sectionCount - 1); };
      const scaleHandle = (id: 'tl' | 'tr' | 'bl' | 'br', place: string) => (
        <button
          key={id}
          type="button"
          aria-label={STRINGS.canvas.splitResizeHandle}
          title={STRINGS.canvas.splitResizeHandle}
          data-testid={`split-scale-${id}`}
          onPointerDown={(e) => handleFramePointerDown(e, `scale-${id}`, activeSize, e.currentTarget.closest('[data-testid="split-composition"]') as HTMLElement)}
          className={`absolute z-30 h-4 w-4 rounded-sm border-2 border-white bg-[var(--bg-scrim)] shadow hover:bg-[var(--brand-accent)] ${place}`}
        />
      );
      return (
        <div
          data-testid="split-composition"
          className="relative m-auto flex items-center gap-4"
          style={{ zoom: canvasZoom }}
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedPane(null); }}
        >
          {revealing && (<>
            {scaleHandle('tl', '-left-2 top-6 cursor-nwse-resize')}
            {scaleHandle('tr', '-right-2 top-6 cursor-nesw-resize')}
            {scaleHandle('bl', '-left-2 -bottom-2 cursor-nesw-resize')}
            {scaleHandle('br', '-right-2 -bottom-2 cursor-nwse-resize')}
          </>)}
          {Array.from({ length: sectionCount }, (_, paneIdx) => paneIdx).map((paneIdx) => (
            <div key={paneIdx} className="flex flex-col items-center gap-2">
              <span className="flex h-6 items-center gap-1.5 text-[0.6875rem] font-medium text-[var(--text-muted)]">
                {sectionCount === 2 ? (paneIdx === 0 ? STRINGS.canvas.frameLeft : STRINGS.canvas.frameRight) : `Frame ${paneIdx + 1} of ${sectionCount}`} · {activeSize.ratioLabel}
                {paneSelected(paneIdx) && (
                  <button
                    type="button"
                    data-testid="split-frame-remove"
                    onClick={removePane}
                    aria-label={STRINGS.canvas.splitFrameDelete(paneIdx + 1, sectionCount)}
                    title={STRINGS.canvas.splitFrameDelete(paneIdx + 1, sectionCount)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--semantic-danger)] hover:text-[var(--text-primary)]"
                  >
                    <BrandIcon name="trash" size={12} />
                  </button>
                )}
              </span>
              <div
                role="button"
                tabIndex={0}
                aria-pressed={paneSelected(paneIdx)}
                aria-label={STRINGS.canvas.splitFrameSelect(paneIdx + 1, sectionCount)}
                data-testid={`split-frame-${paneIdx}`}
                onPointerDown={(e) => { paneDown.current = { x: e.clientX, y: e.clientY }; handleFramePointerDown(e, revealing ? 'pan' : 'split', activeSize, e.currentTarget); }}
                onClick={(e) => {
                  const down = paneDown.current;
                  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
                  setSelectedPane(paneSelected(paneIdx) ? null : { sizeId: activeSize.id, index: paneIdx });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedPane({ sizeId: activeSize.id, index: paneIdx }); }
                  else if ((e.key === 'Delete' || e.key === 'Backspace') && paneSelected(paneIdx)) { e.preventDefault(); e.stopPropagation(); removePane(); }
                }}
                onDoubleClick={() => setRevealSizeId((current) => current === activeSize.id ? null : activeSize.id)}
                title={STRINGS.canvas.splitCropTitle}
                className={`relative cursor-grab overflow-hidden rounded-[var(--radius-md)] border bg-[var(--bg-surface)] shadow-[var(--shadow-canvas)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] active:cursor-grabbing ${revealing ? "border-[var(--semantic-warning)] ring-2 ring-[var(--semantic-warning)]" : paneSelected(paneIdx) ? 'border-[var(--brand-accent)] ring-2 ring-[var(--brand-accent)]' : "border-[var(--border-default)]"}`}
                style={{ width: splitFrameW, height: splitFrameH, touchAction: 'none' }}
              >
                {inBorderFrame(activeSize, renderStrip(
                  `${photo.title} — Frame ${paneIdx + 1}`,
                  'h-full max-w-none object-cover select-none',
                  {
                    width: `${sectionCount * 100}%`,
                    transform: `translate(${-(paneIdx * 100 / sectionCount) + splitOffsetFor(activeSize.id) + activeSize.crop.panX}%, ${activeSize.crop.panY}%) rotate(${activeSize.crop.rotateDeg}deg) scale(${(activeSize.crop.flipH ? -1 : 1) * activeSize.crop.zoom}, ${(activeSize.crop.flipV ? -1 : 1) * activeSize.crop.zoom})`,
                  },
                ))}
                {paneIdx === sectionCount - 1 && renderOverlaysInsideFrame(activeSize, true)}
              </div>
            </div>
          ))}
          {sectionCount < MAX_SPLIT_FRAMES && (
            <button
              type="button"
              data-testid="split-frame-add"
              onClick={() => changeSplitCount(activeSize.id, sectionCount + 1)}
              title={STRINGS.canvas.splitFrameAddMore(sectionCount + 1)}
              aria-label={STRINGS.canvas.splitFrameAddMore(sectionCount + 1)}
              className="mt-8 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] shadow-md transition-colors hover:border-[var(--brand-accent)] hover:text-[var(--brand-accent)]"
            >
              <BrandIcon name="frame-add" size={18} />
            </button>
          )}
        </div>
      );
    }

    return (
      <div
        data-stage-margin
        className="relative m-auto flex flex-col items-center gap-2"
        style={{ zoom: canvasZoom, transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined }}
      >
        <div className="v2-canvas-meta flex items-center gap-2 text-[0.6875rem] text-[var(--text-muted)]">
          <span className="font-medium text-[var(--text-secondary)]">{activeSize.label}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">
            {output.width}×{output.height} ({activeSize.ratioLabel})
          </span>
          {output.factor > 1 && (
            <span data-testid="output-upscale-factor" title={STRINGS.canvas.outputScaled(output.factor)} className="rounded border border-[var(--brand-accent-border)] bg-[var(--brand-accent-soft)] px-1.5 py-0.5 font-mono tabular-nums text-[var(--brand-accent)]">{output.factor}×</span>
          )}
          {output.factor === 1 && (chosenScale === 2 || chosenScale === 4) && (
            <span data-testid="output-scale-unused" title={STRINGS.canvas.outputScaleUnusedLong(chosenScale)} className="rounded border border-[var(--border-subtle)] px-1.5 py-0.5 text-[0.625rem] text-[var(--text-muted)]">
              {STRINGS.canvas.outputScaleUnused(chosenScale)}
            </span>
          )}
          {output.capped && (
            <span
              role="status"
              data-testid="size-cap-warning"
              title={STRINGS.canvas.sizeCappedLong(output.requestedWidth, output.requestedHeight, output.width, output.height)}
              className="inline-flex items-center gap-1 rounded border border-[var(--semantic-warning)] bg-[var(--semantic-warning-soft)] px-1.5 py-0.5 text-[0.625rem] font-semibold text-[var(--text-primary)]"
            >
              <BrandIcon name="alert" size={11} />
              {STRINGS.canvas.sizeCapped(output.requestedWidth, output.requestedHeight)}
            </span>
          )}
          {activeSize.crop.flipH && <span>· Flipped H</span>}
          {activeSize.crop.flipV && <span>· Flipped V</span>}
          {activeSize.crop.rotateDeg !== 0 && <span>· {activeSize.crop.rotateDeg}°</span>}
        </div>

        <div data-stage-margin className="relative flex items-center gap-3">
          {/* Primary photo frame */}
          <div
            data-testid="canvas-frame"
            onClick={handleVideoPinDrop}
            onPointerDown={(e) => {
              if (handleTouchDown(e)) return;
              if (activeSize.kind === 'video') return;
              // In reveal mode a drag positions the picture under the crop window; otherwise it moves the format on the canvas.
              handleFramePointerDown(e, revealing ? 'pan' : 'move-frame', activeSize, e.currentTarget);
            }}
            /* Only claim a touch move/up/cancel that this frame's own pinch/pan/swipe gesture is tracking
               (started by handleTouchDown above). A one-finger drag that began on a child overlay (text,
               watermark, a resize handle) captures the pointer on that child element, not here, so its
               move/up events still bubble up through this frame; stopping them unconditionally for every
               touch pointer swallowed the drag before handleGlobalPointerMove/Up ever saw it, leaving the
               overlay visually stuck at its starting position. */
            onPointerMove={(e) => { if (e.pointerType === 'touch' && touchPoints.current.has(e.pointerId)) { e.stopPropagation(); handleTouchMove(e); } }}
            onPointerUp={(e) => { if (e.pointerType === 'touch' && touchPoints.current.has(e.pointerId)) { e.stopPropagation(); handleTouchEnd(e); } }}
            onPointerCancel={(e) => { if (e.pointerType === 'touch' && touchPoints.current.has(e.pointerId)) { e.stopPropagation(); handleTouchCancel(e); } }}
            onDoubleClick={() => { if (activeSize.kind === 'photo' && !compareMode) setRevealSizeId(revealing ? null : activeSize.id); }}
            title={activeSize.kind === 'photo' ? STRINGS.canvas.cropHintTitle : undefined}
            className={`relative ${revealing ? 'overflow-visible ring-2 ring-[var(--brand-accent)]' : 'overflow-hidden'} rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-canvas)] select-none ${
              activeSize.kind === 'video' ? 'cursor-crosshair' : revealing ? 'cursor-move' : 'cursor-grab active:cursor-grabbing'
            }`}
            // Touch scrolling/zooming is only suppressed while this frame can actually run a photo pinch/pan
            // gesture - elsewhere (video, compare) the surrounding page must keep scrolling normally.
            style={{ width: frameW, height: frameH, touchAction: activeSize.kind === 'photo' && !compareMode ? 'none' : 'auto' }}
          >
            {revealing && (
              <div
                data-testid="crop-ghost"
                className="pointer-events-none absolute left-1/2 top-1/2 z-20 border border-dashed border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,.7)]"
                style={{ width: ghost.width, height: ghost.height, transform: `translate(calc(-50% + ${(activeSize.crop.panX / 100) * frameW}px), calc(-50% + ${(activeSize.crop.panY / 100) * frameH}px)) scale(${activeSize.crop.flipH ? -1 : 1}, ${activeSize.crop.flipV ? -1 : 1})` }}
              >
                <div className="h-full w-full opacity-35">{renderSurface('edited', '', {}, filterCss)}</div>
                {/* Handles follow the visible IMAGE bounds, not the stationary export frame. */}
                <div className="contents pointer-events-auto" aria-label={STRINGS.canvas.cropResizeLabel}>
                {([['tl', 'top left', 'left-1 top-1 cursor-nwse-resize'], ['tr', 'top right', 'right-1 top-1 cursor-nesw-resize'], ['bl', 'bottom left', 'bottom-1 left-1 cursor-nesw-resize'], ['br', 'bottom right', 'bottom-1 right-1 cursor-nwse-resize']] as const).map(([id, name, place]) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={`Drag ${name} crop corner`}
                    onPointerDown={(e) => handleFramePointerDown(e, `scale-${id}`, activeSize, e.currentTarget.closest('[data-testid="crop-ghost"]') as HTMLElement)}
                    className={`pointer-events-auto absolute z-20 h-3.5 w-3.5 rounded-sm border-2 border-white bg-[var(--bg-scrim)] shadow hover:bg-[var(--brand-accent)] ${place}`}
                  />
                ))}
                <button
                  type="button"
                  aria-label={STRINGS.canvas.dragTopEdge}
                  onPointerDown={(e) => handleFramePointerDown(e, 'scale-top', activeSize, e.currentTarget.closest('[data-testid="crop-ghost"]') as HTMLElement)}
                  className="pointer-events-auto absolute left-1/2 top-1 z-20 h-1.5 w-12 -translate-x-1/2 cursor-ns-resize rounded-full bg-white/75 shadow hover:bg-[var(--brand-accent)]"
                />
                <button
                  type="button"
                  aria-label={STRINGS.canvas.dragBottomEdge}
                  onPointerDown={(e) => handleFramePointerDown(e, 'scale-bottom', activeSize, e.currentTarget.closest('[data-testid="crop-ghost"]') as HTMLElement)}
                  className="pointer-events-auto absolute bottom-1 left-1/2 z-20 h-1.5 w-12 -translate-x-1/2 cursor-ns-resize rounded-full bg-white/75 shadow hover:bg-[var(--brand-accent)]"
                />
                <button
                  type="button"
                  aria-label={STRINGS.canvas.dragLeftEdge}
                  onPointerDown={(e) => handleFramePointerDown(e, 'scale-left', activeSize, e.currentTarget.closest('[data-testid="crop-ghost"]') as HTMLElement)}
                  className="pointer-events-auto absolute left-1 top-1/2 z-20 h-12 w-1.5 -translate-y-1/2 cursor-ew-resize rounded-full bg-white/75 shadow hover:bg-[var(--brand-accent)]"
                />
                <button
                  type="button"
                  aria-label={STRINGS.canvas.dragRightEdge}
                  onPointerDown={(e) => handleFramePointerDown(e, 'scale-right', activeSize, e.currentTarget.closest('[data-testid="crop-ghost"]') as HTMLElement)}
                  className="pointer-events-auto absolute right-1 top-1/2 z-20 h-12 w-1.5 -translate-y-1/2 cursor-ew-resize rounded-full bg-white/75 shadow hover:bg-[var(--brand-accent)]"
                />
                </div>
              </div>
            )}
            <div className={revealing ? 'absolute inset-0 overflow-hidden' : 'contents'}>
            {/* Before / After split comparison or single view */}
            {inBorderFrame(activeSize, compareMode ? (
              <CompareSplit
                before={renderSurface('original', `${photo.title} original`, { transform: buildImageTransform(activeSize.crop) }, 'none')}
                after={renderSurface('edited', `${photo.title} edited`, { transform: buildImageTransform(activeSize.crop) }, filterCss)}
              />
            ) : (
              renderSurface(holdingOriginal ? 'original' : 'edited', holdingOriginal ? `${photo.title} original` : photo.title, { transform: buildImageTransform(activeSize.crop), clipPath: cropClip }, holdingOriginal ? 'none' : filterCss)
            ))}
            {selectedMask && !compareMode && !holdingOriginal && PhotoSurface && (
              <div data-testid="mask-canvas-label" className="absolute bottom-2 left-2 z-30 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded bg-[var(--bg-scrim)] px-2 py-1 text-[11px] font-medium text-white">
                <span role="status" className="truncate">{maskOverlayVisible ? STRINGS.maskCanvas.overlayShown(selectedMask.name) : STRINGS.maskCanvas.overlayHidden(selectedMask.name)}</span>
                {onToggleMaskOverlay && (
                  <button type="button" aria-pressed={maskOverlayVisible} aria-label={STRINGS.maskCanvas.toggleOverlay} title={STRINGS.maskCanvas.toggleOverlay}
                    onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onToggleMaskOverlay(); }}
                    className="shrink-0 rounded border border-white/60 px-1.5 font-mono text-[10px] leading-4 hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                    {maskOverlayKey ?? '◐'}
                  </button>
                )}
              </div>
            )}
            {holdingOriginal && (
              <span role="status" className="pointer-events-none absolute left-2 top-2 z-30 rounded bg-[var(--bg-scrim)] px-2 py-1 text-[0.6875rem] font-semibold text-white">{STRINGS.canvas.showingOriginal}</span>
            )}

            </div>

            {/* Video Zoom MP4 Focal Pin */}
            {activeSize.kind === 'video' && features.zoomVideo && (
              <div
                className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${photo.videoZoom.focalX}%`, top: `${photo.videoZoom.focalY}%` }}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)] shadow-lg">
                  <BrandIcon name="focal-point" size={20} />
                </div>
                <span className="mt-1 block rounded bg-[var(--bg-scrim)] px-1.5 py-0.5 text-center text-[0.625rem] font-medium text-white whitespace-nowrap">
                  {photo.videoZoom.direction === 'in' ? STRINGS.canvas.zoomIn : STRINGS.canvas.zoomOut} · {photo.videoZoom.durationSec}s
                </span>
              </div>
            )}

            {gridMode !== 'off' && (
              <svg aria-hidden="true" data-testid="composition-grid" className="pointer-events-none absolute inset-0 z-10 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                {(gridMode === '3x3' ? [100 / 3, 200 / 3] : [25, 50, 75]).flatMap((at) => [
                  <line key={`v${at}`} x1={at} y1="0" x2={at} y2="100" stroke="white" strokeOpacity="0.55" strokeWidth="0.35" vectorEffect="non-scaling-stroke" strokeDasharray="4 3" />,
                  <line key={`h${at}`} x1="0" y1={at} x2="100" y2={at} stroke="white" strokeOpacity="0.55" strokeWidth="0.35" vectorEffect="non-scaling-stroke" strokeDasharray="4 3" />,
                ])}
              </svg>
            )}

            {/* Text & Watermark Overlays with suggested snapping */}
            {!compareMode && renderOverlaysInsideFrame(activeSize, true)}
          </div>

          {/* "+" Split-Frame canvas affordance directly beside the frame */}
          {features.splitFrames && (
            <button
              type="button"
              onClick={() => changeSplitCount(activeSize.id, 2)}
              title={STRINGS.canvas.splitFrameAdd}
              aria-label={STRINGS.canvas.splitFrameAdd}
              className="hidden sm:flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)] shadow-md transition-colors hover:border-[var(--brand-accent)] hover:text-[var(--brand-accent)]"
            >
              <BrandIcon name="frame-add" size={18} />
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderAllFormatsBoard = () => {
    const boardSizes = enabledSizes.length > 0 ? enabledSizes : [activeSize];
    return (
      <div
        data-testid="all-formats-board"
        onClick={(e) => { if (e.target === e.currentTarget) onClearSizeSelection(); }}
        className="m-auto flex flex-wrap items-center justify-center gap-6 p-6"
        style={{ zoom: canvasZoom }}
      >
        {boardSizes.map((size) => {
          const isSelected = selectedSizeIds.includes(size.id);
          const isPrimary = activeSizeId === size.id;
          const aspect = size.width / Math.max(1, size.height);
          const targetH = aspect < 0.7 ? 270 : 210;
          const panes = Array.from({ length: splitCountFor(size.id) }, (_, paneIdx) => paneIdx);
          // On 320/390px screens a three-frame composition must not hide its
          // last pane outside the stage. Scale its preview cards together,
          // preserving the selected format's aspect rather than stretching it.
          const idealW = Math.round(clamp(targetH * aspect, 145, 340));
          const availableW = stageSize.width > 0
            ? Math.max(64, Math.floor((stageSize.width - 48 - (panes.length - 1) * 4) / panes.length))
            : idealW;
          const cardW = panes.length > 1 ? Math.min(idealW, availableW) : idealW;
          const cardH = panes.length > 1 ? Math.round(cardW / aspect) : targetH;
          return (
            <div key={size.id} className="flex items-start gap-1" data-testid={`format-pair-${size.id}`} style={{ transform: `translate(${boardPlacements[`${photo.id}:${size.id}`]?.x ?? size.boardX}px, ${boardPlacements[`${photo.id}:${size.id}`]?.y ?? size.boardY}px)` }}>
            {panes.map((paneIdx) => (
            <div
              key={`${size.id}-${paneIdx}`}
              data-testid={`artboard-${size.id}-${paneIdx}`}
              className={`flex flex-col rounded-[var(--radius-md)] border bg-[var(--bg-surface)] shadow-[var(--shadow-panel)] transition-colors ${
                isSelected
                  ? 'border-[var(--brand-accent)] ring-1 ring-[var(--brand-accent)]'
                  : 'border-[var(--border-default)] hover:border-[var(--border-strong)]'
              }`}
            >
              {/* Movable artboard header */}
              <div
                onPointerDown={(e) => handleArtboardPointerDown(e, size)}
                onClick={(e) => handleArtboardClick(e, size.id)}
                style={{ touchAction: 'none' }}
                className="flex cursor-grab items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-2.5 py-1.5 active:cursor-grabbing"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <BrandIcon name="grip" size={12} className="text-[var(--text-muted)]" />
                  <span className="truncate text-[0.6875rem] font-semibold text-[var(--text-primary)]">
                    {size.label}{panes.length > 1 ? ` · ${paneIdx + 1}/${panes.length}` : ''}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[0.625rem] text-[var(--text-muted)] tabular-nums">
                  {size.ratioLabel}
                </span>
              </div>

              {/* Artboard image viewport */}
              <button
                type="button"
                aria-label={`Select ${size.label}${panes.length > 1 ? ` frame ${paneIdx + 1} of ${panes.length}` : ''} format${isSelected ? ' (selected)' : ''}`}
                aria-pressed={isSelected}
                onPointerDown={(e) => { if (e.pointerType !== 'touch') handleArtboardPointerDown(e, size); }}
                onClick={(e) => handleArtboardClick(e, size.id)}
                onDoubleClick={() => {
                  onSelectSize(size.id);
                  onSetLayoutMode('single');
                  setRevealSizeId(size.id);
                }}
                className="relative overflow-hidden bg-[var(--bg-canvas)] text-left"
                style={{ width: cardW, height: cardH }}
              >
                {inBorderFrame(size, renderStrip(
                  `${photo.title} — ${size.label}`,
                  panes.length > 1 ? 'h-full max-w-none object-cover' : 'h-full w-full object-cover',
                  {
                    ...(panes.length > 1 ? { width: `${panes.length * 100}%` } : {}),
                    transform: panes.length > 1
                      ? `translate(${-(paneIdx * 100 / panes.length) + splitOffsetFor(size.id) + size.crop.panX}%, ${size.crop.panY}%) rotate(${size.crop.rotateDeg}deg) scale(${(size.crop.flipH ? -1 : 1) * size.crop.zoom}, ${(size.crop.flipV ? -1 : 1) * size.crop.zoom})`
                      : buildImageTransform(size.crop),
                  },
                ))}
                {paneIdx === panes.length - 1 && renderOverlaysInsideFrame(size, false)}
                {size.kind === 'video' && (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-[var(--bg-scrim)] px-1.5 py-0.5 text-[0.625rem] font-medium text-white">
                    <BrandIcon name="video-zoom" size={11} />
                    MP4
                  </span>
                )}
              </button>

              {/* Footer indicators */}
              <div className="flex items-center justify-between px-2.5 py-1 text-[0.625rem] text-[var(--text-muted)]">
                <span>
                  {size.crop.flipH ? 'Flipped H' : size.crop.flipV ? 'Flipped V' : 'Normal'}
                  {size.crop.rotateDeg ? ` · ${size.crop.rotateDeg}°` : ''}
                </span>
                <span className={isPrimary ? 'font-semibold text-[var(--brand-accent)]' : ''}>
                  {isSelected ? 'Selected' : 'Click to select'}
                </span>
              </div>
            </div>
            ))}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <main
      ref={setColumnEl}
      onPointerMove={handleGlobalPointerMove}
      onPointerUp={handleGlobalPointerUp}
      onPointerCancel={handleGlobalPointerUp}
      className="relative flex flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]"
    >
      {/* A child component, so the hook never runs after this component's early returns (React #310). */}
      <ZoomPastPreviewSignal active={pastPreview} photoId={photo.id} onZoomPastPreview={onZoomPastPreview} />
      {/* Top Canvas Bar: View mode (Single vs All Formats Side-by-Side) + Per-selection Flip/Rotate/Compare */}
      <div className="v2-canvas-bar flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/75 px-3 py-1.5 backdrop-blur-sm">
        <div className="flex items-center gap-1.5">
          {/* Single vs All-Formats Side-by-Side Board */}
          <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-0.5">
            <button
              type="button"
              onClick={() => onSetLayoutMode('single')}
              className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-[0.6875rem] font-medium transition-colors whitespace-nowrap ${
                canvasLayoutMode === 'single'
                  ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <BrandIcon name="image" size={13} />
              <span className="v2-phone-label">{STRINGS.canvas.singleView}</span>
            </button>
            <button
              type="button"
              onClick={() => onSetLayoutMode('all-formats')}
              title={STRINGS.canvas.boardArrangeTitle}
              className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-[0.6875rem] font-medium transition-colors whitespace-nowrap ${
                canvasLayoutMode === 'all-formats'
                  ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <BrandIcon name="all-sizes" size={13} />
              <span className="v2-phone-label">All formats ({enabledSizes.length})</span>
            </button>
          </div>
          {/* Which picture is shown, for the single view and the All formats board alike (camera preview or RAW develop). */}
          <PictureSourceBadge picture={photo.picture?.preview} className="h-7 text-[0.6875rem]" />
          {photo.fullDevelop && onDevelopFullSize && (
            <button
              type="button"
              disabled={photo.fullDevelop === 'running'}
              aria-busy={photo.fullDevelop === 'running'}
              onClick={() => onDevelopFullSize(photo.id)}
              title={STRINGS.fullDevelop.help}
              className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:cursor-default disabled:opacity-70 whitespace-nowrap"
            >
              <BrandIcon name={photo.fullDevelop === 'running' ? 'clock' : 'expand'} size={13} />
              <span>{photo.fullDevelop === 'running' ? STRINGS.fullDevelop.running : STRINGS.fullDevelop.button}</span>
            </button>
          )}

          {canvasLayoutMode === 'all-formats' && (
            <>
              <button
                type="button"
                onClick={() => onSelectAllSizes(photo.id, enabledSizes.map((size) => size.id))}
                className="h-7 rounded-[var(--radius-sm)] px-2 text-[0.6875rem] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] whitespace-nowrap"
              >
                {STRINGS.canvas.selectAllFormats}
              </button>
              <button
                type="button"
                onClick={() => {
                  setBoardPlacements((prior) => Object.fromEntries(
                    Object.entries(prior).filter(([key]) => !key.startsWith(`${photo.id}:`))
                  ));
                  onResetArtboards(photo.id);
                }}
                className="h-7 rounded-[var(--radius-sm)] px-2 text-[0.6875rem] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] whitespace-nowrap"
              >
                {STRINGS.canvas.tidyBoard}
              </button>
            </>
          )}

          {canvasLayoutMode === 'single' && (
            <div className="hidden lg:flex items-center gap-1 ml-1">
              {enabledSizes.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelectSize(s.id)}
                  className={`h-7 rounded-[var(--radius-sm)] px-2 text-[0.6875rem] font-medium transition-colors whitespace-nowrap ${
                    activeSize.id === s.id
                      ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {s.ratioLabel}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Fixed contextual actions: never cover a photo or artboard. */}
        {selectedSizeIds.length > 0 && (
          <div
            role="toolbar"
            aria-label={STRINGS.canvas.selectedFormatActions}
            data-testid="selected-format-toolbar"
            className="flex min-w-0 items-center gap-1 overflow-x-auto inflight-scroll"
          >
            <span data-testid="selected-format-count" className={`shrink-0 px-1 text-[0.6875rem] text-[var(--text-muted)] ${canvasLayoutMode === 'single' ? 'v2-phone-hide' : ''}`}>
              {selectedSizeIds.length === 1 ? '1 selected' : `${selectedSizeIds.length} selected`}
            </span>
            {([
              { icon: 'image-plus', label: 'Add format', run: () => onOpenFormats?.(), disabled: !onOpenFormats, pressed: false },
              { icon: 'copy', label: 'Duplicate format', run: () => onDuplicateSize?.(selectedSizeIds[0]), disabled: selectedSizeIds.length !== 1 || !onDuplicateSize, pressed: false },
              { icon: 'crop', label: 'Crop / reposition', run: () => {
                const id = selectedSizeIds[0];
                onSelectSize(id);
                onSetLayoutMode('single');
                setRevealSizeId((current) => current === id ? null : id);
              }, disabled: selectedSizeIds.length !== 1 || activeSize.kind !== 'photo' || compareMode, pressed: revealSizeId === selectedSizeIds[0] },
              { icon: 'arrows-horizontal', label: 'Flip selected formats', run: () => onFlipSizes(photo.id, 'horizontal'), disabled: false, pressed: false },
              { icon: 'rotate', label: 'Rotate selected formats', run: () => onRotateSizes(photo.id), disabled: false, pressed: false },
              { icon: 'compare', label: 'Compare', run: onToggleCompare, disabled: selectedSizeIds.length !== 1 || splitFor(activeSize.id), pressed: compareMode },
              { icon: 'trash', label: 'Delete selected format', run: () => onRemoveSize?.(selectedSizeIds[0]), disabled: selectedSizeIds.length !== 1 || !onRemoveSize, pressed: false },
            ] as const).map((action) => (
              <button
                key={action.label}
                type="button"
                title={action.label}
                aria-label={action.label}
                aria-pressed={action.pressed}
                disabled={action.disabled}
                onClick={action.run}
                className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:bg-[var(--brand-accent-soft)] aria-pressed:text-[var(--brand-accent)] max-md:h-11 max-md:min-w-11"
              >
                <BrandIcon name={action.icon} size={16} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Warning banners: Original Unavailable OR Text Overlay Overflow */}
      {(!photo.originalConnected || overflowIssues.length > 0) && (
        <div className="flex flex-col gap-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2">
          {!photo.originalConnected && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--semantic-warning)]"
            >
              <span className="flex items-center gap-2 font-medium">
                <BrandIcon name="image-off" size={15} />
                <span>{STRINGS.canvas.originalUnavailableTitle}</span>
                <span className="hidden md:inline font-normal text-[var(--text-secondary)]">
                  — {STRINGS.canvas.originalUnavailableBody}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onReconnectOriginal(photo.id)}
                className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2.5 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
              >
                <BrandIcon name="relink" size={13} />
                <span>{STRINGS.canvas.reconnectOriginal}</span>
              </button>
            </div>
          )}

          {overflowIssues.length > 0 && (
            <div
              role="alert"
              className="flex items-center gap-2 text-xs font-medium text-[var(--semantic-danger)]"
            >
              <BrandIcon name="alert" size={15} />
              <span>
                {STRINGS.canvas.overflowWarning} ({overflowIssues.map((i) => i.sizeLabel).join(', ')})
              </span>
            </div>
          )}
        </div>
      )}

      {/* Stage, with the controls that float over it. They sit outside the scrolling stage, so they stay put when
          the picture is zoomed and scrolled. */}
      <div ref={viewportRef} className="relative flex min-h-0 min-w-0 flex-1">
      <div
        ref={attachStage}
        data-testid="canvas-stage"
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={(e) => handleStagePointerEnd(e, false)}
        onPointerCancel={(e) => handleStagePointerEnd(e, true)}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          if (revealSizeId) setRevealSizeId(null); // Clicking outside the image accepts and exits crop mode.
          if (canvasLayoutMode === 'all-formats') onClearSizeSelection();
        }}
        className={`relative flex flex-1 overflow-auto inflight-scroll p-2 sm:p-6 ${marginPanning ? 'cursor-grabbing' : stageGestures && canvasZoom > 1.01 ? 'cursor-grab' : ''}`}
        style={{
          // The page itself never pinch-zooms over the photo or its margin: the canvas takes that gesture.
          touchAction: stageGestures ? 'none' : undefined,
          // A quiet, theme-aware working-area grid; artboards and exported images are unaffected.
          backgroundImage: 'radial-gradient(circle, var(--border-default) 0.7px, transparent 0.9px)',
          backgroundSize: '22px 22px',
          backgroundPosition: '11px 11px',
        }}
      >
        {hoveredLook && (
          <div className="pointer-events-none absolute left-4 top-4 z-30 rounded-[var(--radius-sm)] border border-[var(--brand-accent-border)] bg-[var(--bg-surface-raised)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] shadow">
            {STRINGS.canvas.previewingLook} <span className="text-[var(--brand-accent)]">{hoveredLook.name}</span>
          </div>
        )}

        {canvasLayoutMode === 'all-formats' ? renderAllFormatsBoard() : renderSingleArtboard()}

      </div>
        {/* Subtle bottom-left interaction hint */}
        {!hideHints && canvasLayoutMode === 'single' && (
          <p data-capture-ignore className="v2-mouse-hint pointer-events-none absolute bottom-3 left-4 right-80 hidden truncate lg:block text-[0.6875rem] text-[var(--text-muted)]">
            {activeSize.kind === 'video'
              ? STRINGS.canvas.zoomVideoHint
              : STRINGS.canvas.dragCropHint}
          </p>
        )}

        {eyeNote && (
          <div role="status" data-capture-ignore data-testid="eye-note"
            className="absolute bottom-14 left-3 z-30 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2.5 py-1 text-[0.6875rem] text-[var(--text-primary)] shadow">
            <span>{eyeNote.text}</span>
            {!eyeNote.busy && (
              <button type="button" aria-label={STRINGS.canvas.dismissNote} onClick={() => setEyeNote(null)}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]">
                <BrandIcon name="close" size={11} />
              </button>
            )}
          </div>
        )}

        {shotNote && (
          <p role="status" data-capture-ignore className="absolute bottom-14 right-3 z-30 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2.5 py-1 text-[0.6875rem] text-[var(--text-primary)] shadow">{shotNote}</p>
        )}

        {/* BottomRightCluster: Zoom controls, Grid View toggle, and ONE Full Screen button */}
        <div
          aria-label={STRINGS.canvas.viewportControls}
          data-capture-ignore
          ref={zoomBarRef}
          role="toolbar"
          data-testid="canvas-viewport-controls"
          data-docked={isDocked(zoomBarOffset) ? 'true' : 'false'}
          className="absolute z-30 flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)]/95 p-1 shadow-[var(--shadow-popover)] backdrop-blur-sm"
          style={{ right: 12 + zoomBarOffset.right, bottom: 12 + zoomBarOffset.bottom }}
        >
          <button
            type="button"
            data-testid="zoom-bar-grip"
            aria-label={STRINGS.canvas.zoomBarMove}
            title={STRINGS.canvas.zoomBarMoveTitle}
            onPointerDown={startZoomBarDrag}
            onPointerMove={moveZoomBar}
            onPointerUp={endZoomBarDrag}
            onPointerCancel={endZoomBarDrag}
            onDoubleClick={() => saveZoomBarOffset(DOCKED)}
            onKeyDown={(event) => {
              const next = nudgeDockOffset(zoomBarOffset, event.key);
              if (!next) return;
              event.preventDefault();
              saveZoomBarOffset(clampZoomBar(next));
            }}
            className="v2-zoom-fine inline-flex h-8 w-5 cursor-grab touch-none items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] active:cursor-grabbing"
          >
            <BrandIcon name="grip" size={14} />
          </button>
          <button
            type="button"
            aria-label={STRINGS.canvas.zoomOut}
            onClick={() => onSetZoom(canvasZoom / 1.25)}
            className="v2-zoom-fine inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <BrandIcon name="minus" size={14} />
          </button>
          <div className="relative">
            <button
              ref={zoomPercentRef}
              type="button"
              aria-label={STRINGS.canvas.zoomMenu(actualPercent)}
              title={STRINGS.canvas.zoomMenu(actualPercent)}
              aria-haspopup="menu"
              aria-expanded={zoomMenuOpen}
              data-testid="zoom-percent"
              onClick={() => setZoomMenuOpen((open) => !open)}
              className="h-8 min-w-[46px] rounded-[var(--radius-sm)] px-1.5 font-mono text-[0.6875rem] font-medium text-[var(--text-primary)] tabular-nums hover:bg-[var(--bg-surface-hover)]"
            >
              {actualPercent}%
            </button>
            {zoomMenuOpen && (
              <div ref={zoomMenuRef} role="menu" aria-label={STRINGS.canvas.zoomMenuLabel} data-testid="zoom-menu"
                className="absolute bottom-full left-1/2 z-40 mb-2 w-52 -translate-x-1/2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] py-1 shadow-[var(--shadow-popover)]">
                {[
                  { id: 'fit', label: STRINGS.canvas.zoomFitScreen, run: () => zoomAroundCentre(1), current: Math.abs(canvasZoom - 1) < 0.001 },
                  { id: '100', label: STRINGS.canvas.zoomActual, run: () => zoomAroundCentre(fitScale ? 1 / fitScale : 1), current: actualPercent === 100 },
                  { id: 'eye', label: STRINGS.canvas.zoomEye, run: () => { void zoomToEye(); }, current: false, disabled: activeSize.kind !== 'photo' || compareMode || Boolean(eyeNote?.busy) },
                ].map((item) => (
                  <button key={item.id} type="button" role="menuitem" data-testid={`zoom-menu-${item.id}`} disabled={item.disabled}
                    onClick={() => { setZoomMenuOpen(false); item.run(); }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50">
                    <span>{item.label}</span>
                    {item.current && <span className="text-[0.625rem] text-[var(--text-muted)]">{STRINGS.canvas.zoomCurrent}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label={STRINGS.canvas.zoomIn}
            onClick={() => onSetZoom(canvasZoom * 1.25)}
            className="v2-zoom-fine inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <BrandIcon name="plus" size={14} />
          </button>

          <div className="mx-0.5 h-5 w-px bg-[var(--border-subtle)]" aria-hidden="true" />

          <button
            type="button"
            data-testid="grid-toggle"
            title={STRINGS.canvas.gridTitle(gridMode)}
            aria-label={STRINGS.canvas.gridTitle(gridMode)}
            aria-pressed={gridMode !== 'off'}
            onClick={() => setGridMode((mode) => mode === 'off' ? '3x3' : mode === '3x3' ? '4x4' : 'off')}
            className="inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-[var(--radius-sm)] px-1 text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] aria-pressed:text-[var(--brand-accent)]"
          >
            <BrandIcon name="grid" size={15} />
            {gridMode !== 'off' && <span className="text-[0.625rem] font-semibold">{gridMode === '3x3' ? '3×3' : '4×4'}</span>}
          </button>

          <button
            type="button"
            title={STRINGS.canvas.screenshotTitle}
            aria-label={STRINGS.canvas.screenshot}
            data-testid="grab-screenshot"
            onClick={() => void grabScreenshot()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <BrandIcon name="save" size={15} />
          </button>

          <button
            type="button"
            title={isFullScreen ? STRINGS.canvas.fullScreenExit : STRINGS.canvas.fullScreenEnter}
            aria-label={isFullScreen ? STRINGS.canvas.fullScreenExit : STRINGS.canvas.fullScreenEnter}
            onClick={onToggleFullScreen}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <BrandIcon name={isFullScreen ? 'collapse' : 'expand'} size={15} />
          </button>
        </div>
      </div>
    </main>
  );
}
