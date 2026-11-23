import { stepFrom, swipeIntent } from '../utils/swipe';
import { cropHandleZoom, type CropHandleSide } from '../utils/cropHandleZoom';
import React, { useEffect, useRef, useState } from 'react';
import type {
  CropTransform,
  EditGroup,
  FeatureKey,
  FontOption,
  LookPreset,
  OverlaySettings,
  Photo,
  PhotoSurfaceProps,
  SizePreset,
  VideoZoomConfig,
  WatermarkPreset,
} from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import CompareSplit from './CompareSplit';
import { captureElement, screenshotName } from '../utils/captureElement';
import {
  buildPreviewFilterCss,
  cropPanLimits,
  clamp,
  detectOverlayOverflow,
  effectiveOutputSize,
  formatOverlayRowText,
  getActiveGroup,
  snapOverlayPosition,
  type SnapGeometry,
  type SnapGuide,
} from '../utils/studioMath';

interface CanvasProps {
  /** Engine-supplied renderer; falls back to a plain image. */
  PhotoSurface?: React.ComponentType<PhotoSurfaceProps>;
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
  calmView: boolean;
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
  onSetSplitPanOffset: (photoId: string, offset: number) => void;
  onUpdateVideoZoom: (photoId: string, patch: Partial<VideoZoomConfig>) => void;
  onUpdateOverlay: (photoId: string, patch: Partial<OverlaySettings>) => void;
  onReconnectOriginal: (photoId: string) => void;
  onToggleCompare: () => void;
  onSetZoom: (zoom: number) => void;
  onToggleFullScreen: () => void;
}

export default function Canvas({
  PhotoSurface,
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
  calmView,
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
  onSetSplitPanOffset,
  onUpdateVideoZoom,
  onUpdateOverlay,
  onReconnectOriginal,
  onToggleCompare,
  onSetZoom,
  onToggleFullScreen,
}: CanvasProps) {
  const [activeGuides, setActiveGuides] = useState<SnapGuide[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const [shotNote, setShotNote] = useState<string | null>(null);
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
  const touchGesture = useRef<{ distance: number; zoom: number; panX: number; panY: number; centreX: number; centreY: number } | null>(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);
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
        Select a photograph from the filmstrip to begin editing.
      </main>
    );
  }

  const group: EditGroup = getActiveGroup(photo);
  // Compare shows the original and the edit side by side across one frame; a split spans two frames, so it is off then.
  const splitFor = (sizeId: string) => features.splitFrames && photo.formatSplits?.[sizeId]?.enabled === true;
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
      origA = group.overlay.textX;
      origB = group.overlay.textY;
      setDraggingType('text');
    } else if (kind === 'watermark') {
      origA = group.overlay.watermarkX;
      origB = group.overlay.watermarkY;
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
      onUpdateOverlay(photo.id, { textX: snapped.x, textY: snapped.y });
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
      onUpdateOverlay(photo.id, { watermarkX: snapped.x, watermarkY: snapped.y });
    } else if ((drag.kind === 'resize-text' || drag.kind === 'resize-watermark') && drag.centre && drag.startDistance) {
      // Corner handles scale the overlay in proportion: how far the pointer is from the box centre, against where it began.
      const ratio = Math.hypot(e.clientX - drag.centre.x, e.clientY - drag.centre.y) / drag.startDistance;
      if (drag.kind === 'resize-text' && drag.origSizes) {
        onUpdateOverlay(photo.id, { rows: group.overlay.rows.map((row, index) => ({ ...row, sizePx: Math.round(clamp((drag.origSizes![index] ?? row.sizePx) * ratio, 8, 120)) })) });
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

  const handleTouchDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'touch' || activeSize.kind !== 'photo' || compareMode) return false;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    touchPoints.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPoints.current.size === 2) {
      const [a, b] = [...touchPoints.current.values()];
      touchGesture.current = {
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        zoom: activeSize.crop.zoom, panX: activeSize.crop.panX, panY: activeSize.crop.panY,
        centreX: (a.x + b.x) / 2, centreY: (a.y + b.y) / 2,
      };
      endHold();
      if (swipeRef.current) swipeRef.current.pinched = true;
    } else if (touchPoints.current.size === 1) {
      handleFramePointerDown(e, 'pan', activeSize, e.currentTarget);
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
      const zoom = clamp(start.zoom * Math.hypot(a.x - b.x, a.y - b.y) / start.distance, 1, MAX_CROP_ZOOM);
      const rect = e.currentTarget.getBoundingClientRect();
      const centreX = (a.x + b.x) / 2;
      const centreY = (a.y + b.y) / 2;
      const focalX = (start.centreX - rect.left) / Math.max(1, rect.width) - 0.5;
      const focalY = (start.centreY - rect.top) / Math.max(1, rect.height) - 0.5;
      const limits = panLimits(activeSize, zoom);
      onUpdateCrop(photo.id, activeSize.id, {
        zoom: Number(zoom.toFixed(3)),
        panX: clamp(start.panX + (centreX - start.centreX) / Math.max(1, rect.width) * 100 + (start.zoom - zoom) * focalX * 100, -limits.x, limits.x),
        panY: clamp(start.panY + (centreY - start.centreY) / Math.max(1, rect.height) * 100 + (start.zoom - zoom) * focalY * 100, -limits.y, limits.y),
      });
    } else if (touchPoints.current.size === 1) {
      handleGlobalPointerMove(e);
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
      if (swipe && !swipe.pinched && !heldOriginal && revealSizeId !== activeSize.id && activeSize.crop.zoom <= 1) {
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
      const [id, point] = [...touchPoints.current.entries()][0];
      dragRef.current = {
        kind: 'pan', sizeId: activeSize.id, startX: point.x, startY: point.y,
        origA: activeSize.crop.panX, origB: activeSize.crop.panY, crop: activeSize.crop,
        rect: e.currentTarget.getBoundingClientRect(),
      };
      void id;
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
      <div className="pointer-events-none absolute inset-0 z-20" style={{ containerType: 'inline-size' }} data-testid="overlay-layer">
        {/* Magnetic snap guide lines while dragging text or watermark */}
        {interactive &&
          activeGuides.map((guide, idx) =>
            guide.axis === 'x' ? (
              <div
                key={`gx-${idx}`}
                className="pointer-events-none absolute inset-y-0 z-30 border-l border-dashed border-[var(--brand-accent)]"
                style={{ left: `${guide.percent}%` }}
              >
                <span className="absolute top-2 left-1.5 rounded bg-[var(--brand-accent)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--text-on-accent)] whitespace-nowrap">
                  {guide.label}
                </span>
              </div>
            ) : (
              <div
                key={`gy-${idx}`}
                className="pointer-events-none absolute inset-x-0 z-30 border-t border-dashed border-[var(--brand-accent)]"
                style={{ top: `${guide.percent}%` }}
              >
                <span className="absolute right-2 -top-5 rounded bg-[var(--brand-accent)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--text-on-accent)] whitespace-nowrap">
                  {guide.label}
                </span>
              </div>
            )
          )}

        {/* Text Overlay */}
        {overlay.textEnabled && features.overlayText && overlay.rows.length > 0 && (
          <div
            onPointerDown={
              interactive
                ? (e) =>
                    handleFramePointerDown(
                      e,
                      'text',
                      size,
                      e.currentTarget.parentElement
                    )
                : undefined
            }
            data-overlay="text"
            title={interactive ? 'Drag to reposition text overlay (snaps to watermark & safe margins)' : undefined}
            className={`group/overlay z-20 select-none ${
              overlay.textLayoutMode === 'cover-full'
                ? 'absolute inset-0 flex flex-col items-center justify-center text-center'
                : 'absolute max-w-[90%] -translate-y-1/2 rounded-[var(--radius-sm)]'
            } ${interactive ? 'pointer-events-auto cursor-move ring-1 ring-transparent hover:ring-[var(--brand-accent)]' : 'pointer-events-none'}`}
            style={
              overlay.textLayoutMode === 'cover-full'
                ? {
                    padding: cqw(24),
                    backgroundColor: overlay.textScrim
                      ? overlay.textColour === 'light'
                        ? 'rgba(10, 12, 16, 0.48)'
                        : 'rgba(246, 244, 238, 0.56)'
                      : 'transparent',
                    color: overlay.textColour === 'light' ? '#F8F6F2' : '#14171F',
                  }
                : {
                    padding: `${cqw(8)} ${cqw(12)}`,
                    left: `${overlay.textX}%`,
                    top: `${overlay.textY}%`,
                    // A fixed-centre anchor (translate always -50%, never -X%) keeps the physical point
                    // under the pointer continuous as textX crosses 35%/65% - the old translate(-X%, -50%)
                    // jumped because the anchor itself moved with X.
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: overlay.textScrim
                      ? overlay.textColour === 'light'
                        ? 'rgba(10, 12, 16, 0.62)'
                        : 'rgba(246, 244, 238, 0.72)'
                      : 'transparent',
                    color: overlay.textColour === 'light' ? '#F8F6F2' : '#14171F',
                  }
            }
          >
            {interactive && (
              <>
                {(['top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize', 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize', 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize', 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize'] as const).map((place) => (
                  <button
                    key={place}
                    type="button"
                    aria-label="Resize text"
                    onPointerDown={(e) => handleFramePointerDown(e, 'resize-text', size, e.currentTarget.closest('[data-overlay]')?.parentElement?.parentElement)}
                    className={`pointer-events-auto absolute z-30 h-2.5 w-2.5 rounded-sm border border-white bg-[var(--brand-accent)] opacity-0 shadow hover:opacity-100 group-hover/overlay:opacity-100 focus-visible:opacity-100 ${place}`}
                  />
                ))}
              </>
            )}
            {overlay.rows.map((row) => (
              <p
                key={row.id}
                className="leading-snug whitespace-nowrap"
                style={{
                  fontFamily: getFontFamily(row.fontId),
                  fontSize: cqw(row.sizePx),
                  fontWeight: row.weight,
                  letterSpacing: cqw(row.letterSpacing),
                }}
              >
                {formatOverlayRowText(row, photo) || 'Custom caption'}
              </p>
            ))}
          </div>
        )}

        {/* Watermark Overlay */}
        {overlay.watermarkEnabled && features.watermarkCustom && watermarkPreset && (
          <div
            onPointerDown={
              interactive
                ? (e) =>
                    handleFramePointerDown(
                      e,
                      'watermark',
                      size,
                      e.currentTarget.parentElement
                    )
                : undefined
            }
            data-overlay="watermark"
            title={interactive ? 'Drag to reposition watermark (snaps cleanly to text overlay)' : undefined}
            className={`group/overlay absolute z-20 select-none rounded text-right ${
              interactive ? 'pointer-events-auto cursor-move ring-1 ring-transparent hover:ring-[var(--brand-accent)]' : 'pointer-events-none'
            }`}
            style={{
              padding: `${cqw(4)} ${cqw(10)}`,
              left: `${overlay.watermarkX}%`,
              top: `${overlay.watermarkY}%`,
              // Fixed-centre anchor and scale origin, for the same reason as the text overlay above: the
              // box's own centre stays the reference point for both position and resize, not a point that
              // slides to wherever watermarkX currently is.
              transformOrigin: '50% 50%',
              transform: `translate(-50%, -50%) scale(${
                overlay.watermarkScale / 100
              })`,
              opacity: overlay.watermarkOpacity / 100,
              color: effectiveContrast === 'light-on-dark' ? '#F8F6F2' : '#14171F',
              backgroundColor: watermarkImage
                ? 'transparent'
                : effectiveContrast === 'light-on-dark'
                  ? 'rgba(9, 11, 15, 0.36)'
                  : 'rgba(248, 246, 242, 0.54)',
            }}
          >
            {interactive && (
              <>
                {(['top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize', 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize', 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize', 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize'] as const).map((place) => (
                  <button
                    key={place}
                    type="button"
                    aria-label="Resize watermark"
                    onPointerDown={(e) => handleFramePointerDown(e, 'resize-watermark', size, e.currentTarget.closest('[data-overlay]')?.parentElement?.parentElement)}
                    className={`pointer-events-auto absolute z-30 h-2.5 w-2.5 rounded-sm border border-white bg-[var(--brand-accent)] opacity-0 shadow hover:opacity-100 group-hover/overlay:opacity-100 focus-visible:opacity-100 ${place}`}
                  />
                ))}
              </>
            )}
            {watermarkImage ? (
              <img src={watermarkImage} alt={watermarkPreset.label} draggable={false} className="w-auto object-contain" style={{ height: cqw(36), maxWidth: cqw(180) }} />
            ) : (
            <p className="font-bold tracking-[0.14em] whitespace-nowrap" style={{ fontSize: cqw(11) }}>
              {watermarkPreset.text}
            </p>
            )}
            {!watermarkImage && watermarkPreset.subtext && (
              <p className="tracking-[0.18em] opacity-80 whitespace-nowrap" style={{ fontSize: cqw(9) }}>
                {watermarkPreset.subtext}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  /** The photo as pixels: the engine's renderer when there is one, otherwise a plain image with the CSS approximation. */
  const renderSurface = (variant: 'edited' | 'original', alt: string, style: React.CSSProperties, filter: string) =>
    PhotoSurface ? (
      <PhotoSurface photoId={photo.id} variant={variant} alt={alt} className="h-full w-full" style={style} />
    ) : (
      <img src={photo.previewUrl} alt={alt} referrerPolicy="no-referrer" draggable={false}
        className="h-full w-full object-cover" style={{ ...style, filter }} />
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
  // The format's real output size: never more pixels than the picture has.
  const output = effectiveOutputSize(activeSize, photo.pixelSize);
  const actualPercent = fitScale ? Math.round(fitScale * canvasZoom * 100) : Math.round(canvasZoom * 100);
  const toggleActualSize = () => {
    if (!fitScale) { onSetZoom(1); return; }
    onSetZoom(Math.abs(actualPercent - 100) <= 1 ? 1 : 1 / fitScale);
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
      // Each pane has the selected format's full aspect ratio. Fit BOTH panes and their
      // 16px gap into the working area; a single-pane Fit width would overflow on phones.
      // Account for canvas zoom rather than clipping the second pane off-screen.
      const splitWidthBudget = stageSize.width > 0
        ? Math.max(1, ((stageSize.width - 32) / Math.max(0.01, canvasZoom) - 16) / 2)
        : frameW;
      const splitFrameW = Math.min(frameW, splitWidthBudget);
      const splitFrameH = splitFrameW / aspect;
      return (
        <div
          className="m-auto flex items-center gap-4"
          style={{ zoom: canvasZoom }}
        >
          {[0, 1].map((paneIdx) => (
            <div key={paneIdx} className="flex flex-col items-center gap-2">
              <span className="text-[11px] font-medium text-[var(--text-muted)]">
                {paneIdx === 0 ? STRINGS.canvas.frameLeft : STRINGS.canvas.frameRight} · 1:1
              </span>
              <div
                onPointerDown={(e) => handleFramePointerDown(e, revealing ? 'pan' : 'split', activeSize, e.currentTarget)}
                onDoubleClick={() => setRevealSizeId((current) => current === activeSize.id ? null : activeSize.id)}
                title={STRINGS.canvas.splitCropTitle}
                className={`relative cursor-grab overflow-hidden rounded-[var(--radius-md)] border bg-[var(--bg-surface)] shadow-[var(--shadow-canvas)] active:cursor-grabbing ${revealing ? "border-[var(--semantic-warning)] ring-2 ring-[var(--semantic-warning)]" : "border-[var(--border-default)]"}`}
                style={{ width: splitFrameW, height: splitFrameH }}
              >
                {inBorderFrame(activeSize, <img
                  src={photo.previewUrl}
                  alt={`${photo.title} — Frame ${paneIdx + 1}`}
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className="h-full w-[200%] max-w-none object-cover select-none"
                  style={{
                    filter: compareMode ? 'none' : filterCss,
                    transform: `translate(${paneIdx === 0 ? splitOffsetFor(activeSize.id) + activeSize.crop.panX : -50 + splitOffsetFor(activeSize.id) + activeSize.crop.panX}%, ${activeSize.crop.panY}%) rotate(${activeSize.crop.rotateDeg}deg) scale(${(activeSize.crop.flipH ? -1 : 1) * activeSize.crop.zoom}, ${(activeSize.crop.flipV ? -1 : 1) * activeSize.crop.zoom})`,
                  }}
                />)}
                {paneIdx === 1 && renderOverlaysInsideFrame(activeSize, true)}
              </div>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div
        className="relative m-auto flex flex-col items-center gap-2"
        style={{ zoom: canvasZoom, transform: offset ? `translate(${offset.x}px, ${offset.y}px)` : undefined }}
      >
        <div className="v2-canvas-meta flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <span className="font-medium text-[var(--text-secondary)]">{activeSize.label}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">
            {output.width}×{output.height} ({activeSize.ratioLabel})
          </span>
          {output.capped && (
            <span
              role="status"
              data-testid="size-cap-warning"
              title={STRINGS.canvas.sizeCappedLong(output.requestedWidth, output.requestedHeight, output.width, output.height)}
              className="inline-flex items-center gap-1 rounded border border-[var(--semantic-warning)] bg-[var(--semantic-warning-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-primary)]"
            >
              <BrandIcon name="alert" size={11} />
              {STRINGS.canvas.sizeCapped(output.requestedWidth, output.requestedHeight)}
            </span>
          )}
          {activeSize.crop.flipH && <span>· Flipped H</span>}
          {activeSize.crop.flipV && <span>· Flipped V</span>}
          {activeSize.crop.rotateDeg !== 0 && <span>· {activeSize.crop.rotateDeg}°</span>}
        </div>

        <div className="relative flex items-center gap-3">
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
                  aria-label="Drag top crop edge"
                  onPointerDown={(e) => handleFramePointerDown(e, 'scale-top', activeSize, e.currentTarget.closest('[data-testid="crop-ghost"]') as HTMLElement)}
                  className="pointer-events-auto absolute left-1/2 top-1 z-20 h-1.5 w-12 -translate-x-1/2 cursor-ns-resize rounded-full bg-white/75 shadow hover:bg-[var(--brand-accent)]"
                />
                <button
                  type="button"
                  aria-label="Drag bottom crop edge"
                  onPointerDown={(e) => handleFramePointerDown(e, 'scale-bottom', activeSize, e.currentTarget.closest('[data-testid="crop-ghost"]') as HTMLElement)}
                  className="pointer-events-auto absolute bottom-1 left-1/2 z-20 h-1.5 w-12 -translate-x-1/2 cursor-ns-resize rounded-full bg-white/75 shadow hover:bg-[var(--brand-accent)]"
                />
                <button
                  type="button"
                  aria-label="Drag left crop edge"
                  onPointerDown={(e) => handleFramePointerDown(e, 'scale-left', activeSize, e.currentTarget.closest('[data-testid="crop-ghost"]') as HTMLElement)}
                  className="pointer-events-auto absolute left-1 top-1/2 z-20 h-12 w-1.5 -translate-y-1/2 cursor-ew-resize rounded-full bg-white/75 shadow hover:bg-[var(--brand-accent)]"
                />
                <button
                  type="button"
                  aria-label="Drag right crop edge"
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
            {holdingOriginal && (
              <span role="status" className="pointer-events-none absolute left-2 top-2 z-30 rounded bg-[var(--bg-scrim)] px-2 py-1 text-[11px] font-semibold text-white">Showing the original. Let go to see your edit.</span>
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
                <span className="mt-1 block rounded bg-[var(--bg-scrim)] px-1.5 py-0.5 text-center text-[10px] font-medium text-white whitespace-nowrap">
                  {photo.videoZoom.direction === 'in' ? 'Zoom in' : 'Zoom out'} · {photo.videoZoom.durationSec}s
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
              onClick={() => onToggleSplitFrames(photo.id)}
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
          const cardH = aspect < 0.7 ? 270 : 210;
          const cardW = Math.round(clamp(cardH * aspect, 145, 340));

          const panes = splitFor(size.id) ? [0, 1] : [0];
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
                  <span className="truncate text-[11px] font-semibold text-[var(--text-primary)]">
                    {size.label}{panes.length === 2 ? ` · ${paneIdx + 1}/2` : ''}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
                  {size.ratioLabel}
                </span>
              </div>

              {/* Artboard image viewport */}
              <button
                type="button"
                aria-label={`Select ${size.label}${panes.length === 2 ? ` frame ${paneIdx + 1}` : '' } format${isSelected ? ' (selected)' : ''}`}
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
                {inBorderFrame(size, <img
                  src={photo.previewUrl}
                  alt={`${photo.title} — ${size.label}`}
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className={panes.length === 2 ? 'h-full w-[200%] max-w-none object-cover' : 'h-full w-full object-cover'}
                  style={{
                    filter: compareMode ? 'none' : filterCss,
                    transform: panes.length === 2
                      ? `translate(${paneIdx === 0 ? splitOffsetFor(size.id) + size.crop.panX : -50 + splitOffsetFor(size.id) + size.crop.panX}%, ${size.crop.panY}%) rotate(${size.crop.rotateDeg}deg) scale(${(size.crop.flipH ? -1 : 1) * size.crop.zoom}, ${(size.crop.flipV ? -1 : 1) * size.crop.zoom})`
                      : buildImageTransform(size.crop),
                  }}
                />)}
                {paneIdx === panes.length - 1 && renderOverlaysInsideFrame(size, false)}
                {size.kind === 'video' && (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-[var(--bg-scrim)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                    <BrandIcon name="video-zoom" size={11} />
                    MP4
                  </span>
                )}
              </button>

              {/* Footer indicators */}
              <div className="flex items-center justify-between px-2.5 py-1 text-[10px] text-[var(--text-muted)]">
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
      onPointerMove={handleGlobalPointerMove}
      onPointerUp={handleGlobalPointerUp}
      onPointerCancel={handleGlobalPointerUp}
      className="relative flex flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]"
    >
      {/* Top Canvas Bar: View mode (Single vs All Formats Side-by-Side) + Per-selection Flip/Rotate/Compare */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/75 px-3 py-1.5 backdrop-blur-sm">
        <div className="flex items-center gap-1.5">
          {/* Single vs All-Formats Side-by-Side Board */}
          <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-0.5">
            <button
              type="button"
              onClick={() => onSetLayoutMode('single')}
              className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
                canvasLayoutMode === 'single'
                  ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <BrandIcon name="image" size={13} />
              <span>Single</span>
            </button>
            <button
              type="button"
              onClick={() => onSetLayoutMode('all-formats')}
              title="Drag artboard title bars to arrange · Ctrl/Cmd-click formats to edit as a group · Double-click to focus"
              className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
                canvasLayoutMode === 'all-formats'
                  ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <BrandIcon name="all-sizes" size={13} />
              <span>All formats ({enabledSizes.length})</span>
            </button>
          </div>

          {canvasLayoutMode === 'all-formats' && (
            <>
              <button
                type="button"
                onClick={() => onSelectAllSizes(photo.id, enabledSizes.map((size) => size.id))}
                className="h-7 rounded-[var(--radius-sm)] px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] whitespace-nowrap"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => {
                  setBoardPlacements((prior) => Object.fromEntries(
                    Object.entries(prior).filter(([key]) => !key.startsWith(`${photo.id}:`))
                  ));
                  onResetArtboards(photo.id);
                }}
                className="h-7 rounded-[var(--radius-sm)] px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] whitespace-nowrap"
              >
                Tidy board
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
                  className={`h-7 rounded-[var(--radius-sm)] px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
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
            aria-label="Selected format actions"
            data-testid="selected-format-toolbar"
            className="flex min-w-0 items-center gap-1 overflow-x-auto inflight-scroll"
          >
            <span data-testid="selected-format-count" className="shrink-0 px-1 text-[11px] text-[var(--text-muted)]">
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
                className="inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2.5 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
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

      {/* Stage */}
      <div
        ref={stageRef}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          if (revealSizeId) setRevealSizeId(null); // Clicking outside the image accepts and exits crop mode.
          if (canvasLayoutMode === 'all-formats') onClearSizeSelection();
        }}
        className="relative flex flex-1 overflow-auto inflight-scroll p-2 sm:p-6"
        style={{
          // A quiet, theme-aware working-area grid; artboards and exported images are unaffected.
          backgroundImage: 'radial-gradient(circle, var(--border-default) 0.7px, transparent 0.9px)',
          backgroundSize: '22px 22px',
          backgroundPosition: '11px 11px',
        }}
      >
        {hoveredLook && (
          <div className="pointer-events-none absolute left-4 top-4 z-30 rounded-[var(--radius-sm)] border border-[var(--brand-accent-border)] bg-[var(--bg-surface-raised)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] shadow">
            Previewing look: <span className="text-[var(--brand-accent)]">{hoveredLook.name}</span>
          </div>
        )}

        {canvasLayoutMode === 'all-formats' ? renderAllFormatsBoard() : renderSingleArtboard()}

        {/* Subtle bottom-left interaction hint */}
        {!calmView && canvasLayoutMode === 'single' && (
          <p data-capture-ignore className="pointer-events-none absolute bottom-3 left-4 hidden lg:block text-[11px] text-[var(--text-muted)]">
            {activeSize.kind === 'video'
              ? STRINGS.canvas.zoomVideoHint
              : STRINGS.canvas.dragCropHint}
          </p>
        )}

        {shotNote && (
          <p role="status" data-capture-ignore className="absolute bottom-14 right-3 z-30 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2.5 py-1 text-[11px] text-[var(--text-primary)] shadow">{shotNote}</p>
        )}

        {/* BottomRightCluster: Zoom controls, Grid View toggle, and ONE Full Screen button */}
        <div
          aria-label="Canvas viewport controls"
          data-capture-ignore
          className="absolute bottom-3 right-3 z-30 flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)]/95 p-1 shadow-[var(--shadow-popover)] backdrop-blur-sm"
        >
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => onSetZoom(canvasZoom / 1.25)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <BrandIcon name="minus" size={14} />
          </button>
          <button
            type="button"
            aria-label={actualPercent === 100 ? STRINGS.canvas.zoomToFit : STRINGS.canvas.zoomTo100}
            title={actualPercent === 100 ? STRINGS.canvas.zoomToFit : STRINGS.canvas.zoomTo100}
            data-testid="zoom-percent"
            onClick={toggleActualSize}
            className="h-8 min-w-[46px] rounded-[var(--radius-sm)] px-1.5 font-mono text-[11px] font-medium text-[var(--text-primary)] tabular-nums hover:bg-[var(--bg-surface-hover)]"
          >
            {actualPercent}%
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => onSetZoom(canvasZoom * 1.25)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
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
            {gridMode !== 'off' && <span className="text-[10px] font-semibold">{gridMode === '3x3' ? '3×3' : '4×4'}</span>}
          </button>

          <button
            type="button"
            title="Grab screenshot: saves what you see on the canvas, with the edit, crop, overlays and grid"
            aria-label="Grab screenshot"
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
