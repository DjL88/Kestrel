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
  onSelectSize: (sizeId: string, modifiers?: { ctrl?: boolean }) => void;
  onSelectAllSizes: (photoId: string) => void;
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
  onToggleGridView: () => void;
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
  onToggleGridView,
  onToggleFullScreen,
}: CanvasProps) {
  const [activeGuides, setActiveGuides] = useState<SnapGuide[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
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
  } | null>(null);
  // Double-click a format to reveal the whole picture as a ghost and position it under the crop window.
  const [revealSizeId, setRevealSizeId] = useState<string | null>(null);
  // A composition grid over the frame (thirds or quarters) to help place things. Never exported.
  const [gridMode, setGridMode] = useState<'off' | '3x3' | '4x4'>('off');
  // A plain drag moves the format on the canvas, like a design tool. Session only: it is where it sits, not part of the edit.
  const [frameOffsets, setFrameOffsets] = useState<Record<string, { x: number; y: number }>>({});
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
  const compareMode = compareRequested && !group.splitFrames;
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
      origA = group.splitPanOffset;
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
      // Aspect-locked crop: the window keeps the format's shape, so pulling a handle in zooms the picture about the opposite
      // edge or corner, which stays where it is. Pulling out zooms back out, never past the picture's edges.
      const side = drag.kind.slice('scale-'.length);
      const fx = side === 'left' ? dx / width : side === 'right' ? -dx / width : 0;
      const fy = side === 'top' ? dy / height : side === 'bottom' ? -dy / height : 0;
      const corner: Record<string, [number, number]> = { tl: [dx / width, dy / height], tr: [-dx / width, dy / height], bl: [dx / width, -dy / height], br: [-dx / width, -dy / height] };
      const inward = corner[side] ? (corner[side][0] + corner[side][1]) / 2 : fx + fy;
      const zoom = clamp(drag.crop.zoom / Math.max(0.05, 1 - inward), 1, MAX_CROP_ZOOM);
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
      onMoveArtboard(
        photo.id,
        drag.sizeId,
        drag.origA + dx / canvasZoom,
        drag.origB + dy / canvasZoom
      );
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
    } else if (touchPoints.current.size === 1) {
      handleFramePointerDown(e, 'pan', activeSize, e.currentTarget);
    }
    return true;
  };
  const handleTouchMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!touchPoints.current.has(e.pointerId)) return false;
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

  const handleTouchCancel = (e: React.PointerEvent<HTMLElement>) => {
    if (!touchPoints.current.has(e.pointerId)) return false;
    // Cancellation is not a finger lift: never restart a pan with stale pinch state.
    touchPoints.current.clear();
    touchGesture.current = null;
    dragRef.current = null;
    setDraggingType('none');
    setActiveGuides([]);
    return true;
  };

  const handleGlobalPointerUp = () => {
    if (!dragRef.current) return;
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
                    transform: `translate(-${overlay.textX}%, -50%)`,
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
              transformOrigin: `${overlay.watermarkX}% 50%`,
              transform: `translate(-${overlay.watermarkX}%, -50%) scale(${
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

    if (group.splitFrames && features.splitFrames) {
      // Split 1 photo seamlessly across 2 equal side-by-side frames
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
                onPointerDown={(e) => handleFramePointerDown(e, 'split', activeSize, e.currentTarget)}
                className="relative h-[340px] w-[280px] cursor-grab overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-canvas)] active:cursor-grabbing"
              >
                <img
                  src={photo.previewUrl}
                  alt={`${photo.title} — Frame ${paneIdx + 1}`}
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className="h-full w-[200%] max-w-none object-cover select-none"
                  style={{
                    filter: compareMode ? 'none' : filterCss,
                    transform: `translateX(${
                      paneIdx === 0 ? group.splitPanOffset : -50 + group.splitPanOffset
                    }%) scale(${activeSize.crop.zoom})`,
                  }}
                />
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
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
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

        {activeSize.kind === 'photo' && !compareMode && <button type="button" aria-pressed={revealing} onClick={() => setRevealSizeId(revealing ? null : activeSize.id)} className="sm:hidden rounded border border-[var(--border-default)] px-3 py-2 text-xs font-medium">{revealing ? 'Done repositioning' : 'Crop / reposition'}</button>}
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
            onPointerMove={(e) => { if (e.pointerType === 'touch') { e.stopPropagation(); handleTouchMove(e); } }}
            onPointerUp={(e) => { if (e.pointerType === 'touch') { e.stopPropagation(); handleTouchEnd(e); } }}
            onPointerCancel={(e) => { if (e.pointerType === 'touch') { e.stopPropagation(); handleTouchCancel(e); } }}
            onDoubleClick={() => { if (activeSize.kind === 'photo' && !compareMode) setRevealSizeId(revealing ? null : activeSize.id); }}
            title={activeSize.kind === 'photo' ? STRINGS.canvas.cropHintTitle : undefined}
            className={`relative ${revealing ? 'overflow-visible ring-2 ring-[var(--brand-accent)]' : 'overflow-hidden'} rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-canvas)] select-none ${
              activeSize.kind === 'video' ? 'cursor-crosshair' : revealing ? 'cursor-move' : 'cursor-grab active:cursor-grabbing'
            }`}
            style={{ width: frameW, height: frameH, touchAction: activeSize.kind === 'photo' && !compareMode ? 'none' : 'auto' }}
          >
            {revealing && (
              <div
                aria-hidden="true"
                data-testid="crop-ghost"
                className="pointer-events-none absolute left-1/2 top-1/2 opacity-35"
                style={{ width: ghost.width, height: ghost.height, transform: `translate(calc(-50% + ${(activeSize.crop.panX / 100) * frameW}px), calc(-50% + ${(activeSize.crop.panY / 100) * frameH}px)) scale(${activeSize.crop.flipH ? -1 : 1}, ${activeSize.crop.flipV ? -1 : 1})` }}
              >
                {renderSurface('edited', '', {}, filterCss)}
              </div>
            )}
            <div className={revealing ? 'absolute inset-0 overflow-hidden' : 'contents'}>
            {/* Before / After split comparison or single view */}
            {compareMode ? (
              <CompareSplit
                before={renderSurface('original', `${photo.title} original`, { transform: buildImageTransform(activeSize.crop) }, 'none')}
                after={renderSurface('edited', `${photo.title} edited`, { transform: buildImageTransform(activeSize.crop) }, filterCss)}
              />
            ) : (
              renderSurface('edited', photo.title, { transform: buildImageTransform(activeSize.crop), clipPath: cropClip }, filterCss)
            )}

            </div>

            {/* Aspect-locked crop handles: pulling any edge or corner in zooms the picture, the window keeps the format's shape */}
            {!compareMode && activeSize.kind === 'photo' && (
              <>
                {([['tl', 'top left', 'left-1 top-1 cursor-nwse-resize'], ['tr', 'top right', 'right-1 top-1 cursor-nesw-resize'], ['bl', 'bottom left', 'bottom-1 left-1 cursor-nesw-resize'], ['br', 'bottom right', 'bottom-1 right-1 cursor-nwse-resize']] as const).map(([id, name, place]) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={`Drag ${name} crop corner`}
                    onPointerDown={(e) => handleFramePointerDown(e, `scale-${id}`, activeSize, e.currentTarget.parentElement)}
                    className={`absolute z-20 h-3.5 w-3.5 rounded-sm border-2 border-white bg-[var(--bg-scrim)] shadow hover:bg-[var(--brand-accent)] ${place}`}
                  />
                ))}
                <button
                  type="button"
                  aria-label="Drag top crop edge"
                  onPointerDown={(e) => handleFramePointerDown(e, 'scale-top', activeSize, e.currentTarget.parentElement)}
                  className="absolute left-1/2 top-1 z-20 h-1.5 w-12 -translate-x-1/2 cursor-ns-resize rounded-full bg-white/75 shadow hover:bg-[var(--brand-accent)]"
                />
                <button
                  type="button"
                  aria-label="Drag bottom crop edge"
                  onPointerDown={(e) => handleFramePointerDown(e, 'scale-bottom', activeSize, e.currentTarget.parentElement)}
                  className="absolute bottom-1 left-1/2 z-20 h-1.5 w-12 -translate-x-1/2 cursor-ns-resize rounded-full bg-white/75 shadow hover:bg-[var(--brand-accent)]"
                />
                <button
                  type="button"
                  aria-label="Drag left crop edge"
                  onPointerDown={(e) => handleFramePointerDown(e, 'scale-left', activeSize, e.currentTarget.parentElement)}
                  className="absolute left-1 top-1/2 z-20 h-12 w-1.5 -translate-y-1/2 cursor-ew-resize rounded-full bg-white/75 shadow hover:bg-[var(--brand-accent)]"
                />
                <button
                  type="button"
                  aria-label="Drag right crop edge"
                  onPointerDown={(e) => handleFramePointerDown(e, 'scale-right', activeSize, e.currentTarget.parentElement)}
                  className="absolute right-1 top-1/2 z-20 h-12 w-1.5 -translate-y-1/2 cursor-ew-resize rounded-full bg-white/75 shadow hover:bg-[var(--brand-accent)]"
                />
              </>
            )}

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
        className="m-auto flex flex-wrap items-center justify-center gap-6 p-6"
        style={{ zoom: canvasZoom }}
      >
        {boardSizes.map((size) => {
          const isSelected = selectedSizeIds.includes(size.id);
          const isPrimary = activeSizeId === size.id;
          const aspect = size.width / Math.max(1, size.height);
          const cardH = aspect < 0.7 ? 270 : 210;
          const cardW = Math.round(clamp(cardH * aspect, 145, 340));

          return (
            <div
              key={size.id}
              data-testid={`artboard-${size.id}`}
              style={{
                transform: `translate(${size.boardX}px, ${size.boardY}px)`,
              }}
              className={`flex flex-col rounded-[var(--radius-md)] border bg-[var(--bg-surface)] shadow-[var(--shadow-panel)] transition-colors ${
                isSelected
                  ? 'border-[var(--brand-accent)] ring-1 ring-[var(--brand-accent)]'
                  : 'border-[var(--border-default)] hover:border-[var(--border-strong)]'
              }`}
            >
              {/* Movable artboard header */}
              <div
                onPointerDown={(e) => {
                  onSelectSize(size.id, { ctrl: e.ctrlKey || e.metaKey });
                  handleFramePointerDown(e, 'board', size);
                }}
                className="flex cursor-grab items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-2.5 py-1.5 active:cursor-grabbing"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <BrandIcon name="grip" size={12} className="text-[var(--text-muted)]" />
                  <span className="truncate text-[11px] font-semibold text-[var(--text-primary)]">
                    {size.label}
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)] tabular-nums">
                  {size.ratioLabel}
                </span>
              </div>

              {/* Artboard image viewport */}
              <button
                type="button"
                aria-label={`Select ${size.label} format${isSelected ? ' (selected)' : ''}`}
                onClick={(e) => onSelectSize(size.id, { ctrl: e.ctrlKey || e.metaKey })}
                onDoubleClick={() => {
                  onSelectSize(size.id);
                  onSetLayoutMode('single');
                }}
                className="relative overflow-hidden bg-[var(--bg-canvas)] text-left"
                style={{ width: cardW, height: cardH }}
              >
                <img
                  src={photo.previewUrl}
                  alt={`${photo.title} — ${size.label}`}
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className="h-full w-full object-cover"
                  style={{
                    filter: compareMode ? 'none' : filterCss,
                    transform: buildImageTransform(size.crop),
                  }}
                />
                {renderOverlaysInsideFrame(size, false)}
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
          );
        })}
      </div>
    );
  };

  const selectionScopeLabel =
    selectedSizeIds.length > 1
      ? `Group (${selectedSizeIds.length} formats)`
      : `Individual (${activeSize.ratioLabel})`;

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
                onClick={() => onSelectAllSizes(photo.id)}
                className="h-7 rounded-[var(--radius-sm)] px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] whitespace-nowrap"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => onResetArtboards(photo.id)}
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

        {/* Individual vs Group transform actions */}
        <div className="flex items-center gap-1.5">
          {!calmView && (
            <span className="hidden xl:inline text-[11px] text-[var(--text-muted)] mr-1">
              Target: <strong className="font-medium text-[var(--text-secondary)]">{selectionScopeLabel}</strong>
            </span>
          )}
          <button
            type="button"
            title="Flip selected format(s) horizontally"
            aria-label="Flip horizontally"
            onClick={() => onFlipSizes(photo.id, 'horizontal')}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] whitespace-nowrap"
          >
            <BrandIcon name="arrows-horizontal" size={13} />
            <span className="hidden sm:inline">Flip H</span>
          </button>
          <button
            type="button"
            title="Rotate selected format(s) 90°"
            aria-label="Rotate 90 degrees"
            onClick={() => onRotateSizes(photo.id)}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] whitespace-nowrap"
          >
            <BrandIcon name="rotate" size={13} />
            <span className="hidden sm:inline">Rotate</span>
          </button>
          {features.splitFrames && canvasLayoutMode === 'single' && (
            <button
              type="button"
              onClick={() => onToggleSplitFrames(photo.id)}
              className={`inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
                group.splitFrames
                  ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <BrandIcon name="split-panorama" size={13} />
              <span className="hidden sm:inline">{group.splitFrames ? 'Merged: Off' : 'Split 2'}</span>
            </button>
          )}
          <button
            type="button"
            aria-pressed={gridMode !== 'off'}
            title={STRINGS.canvas.gridTitle(gridMode)}
            aria-label={STRINGS.canvas.gridTitle(gridMode)}
            data-testid="grid-toggle"
            onClick={() => setGridMode((mode) => (mode === 'off' ? '3x3' : mode === '3x3' ? '4x4' : 'off'))}
            className={`inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[11px] font-medium whitespace-nowrap ${
              gridMode !== 'off' ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
            }`}
          >
            <BrandIcon name="grid" size={13} />
            <span className="hidden sm:inline">{gridMode === 'off' ? 'Grid' : gridMode === '3x3' ? '3×3' : '4×4'}</span>
          </button>
          <button
            type="button"
            aria-pressed={compareMode}
            disabled={group.splitFrames}
            title={group.splitFrames ? STRINGS.canvas.compareDisabledSplit : STRINGS.topBar.viewActions.compareBeforeAfter}
            onClick={onToggleCompare}
            className={`inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
              compareMode
                ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
            } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`}
          >
            <BrandIcon name="compare" size={13} />
            <span className="hidden sm:inline">Compare</span>
          </button>
        </div>
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
      <div ref={stageRef} className="relative flex flex-1 overflow-auto inflight-scroll p-2 sm:p-6">
        {hoveredLook && (
          <div className="pointer-events-none absolute left-4 top-4 z-30 rounded-[var(--radius-sm)] border border-[var(--brand-accent-border)] bg-[var(--bg-surface-raised)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] shadow">
            Previewing look: <span className="text-[var(--brand-accent)]">{hoveredLook.name}</span>
          </div>
        )}

        {canvasLayoutMode === 'all-formats' ? renderAllFormatsBoard() : renderSingleArtboard()}

        {/* Subtle bottom-left interaction hint */}
        {!calmView && (
          <p className="pointer-events-none absolute bottom-3 left-4 hidden lg:block text-[11px] text-[var(--text-muted)]">
            {canvasLayoutMode === 'all-formats'
              ? 'Drag artboard title bars to arrange · Ctrl/Cmd-click formats to edit as a group · Double-click to focus'
              : activeSize.kind === 'video'
              ? STRINGS.canvas.zoomVideoHint
              : STRINGS.canvas.dragCropHint}
          </p>
        )}

        {/* BottomRightCluster: Zoom controls, Grid View toggle, and ONE Full Screen button */}
        <div
          aria-label="Canvas viewport controls"
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
            <BrandIcon name="zoom-in" size={14} />
          </button>

          <div className="mx-0.5 h-5 w-px bg-[var(--border-subtle)]" aria-hidden="true" />

          <button
            type="button"
            title={STRINGS.canvas.gridViewToggle}
            aria-label={STRINGS.canvas.gridViewToggle}
            onClick={onToggleGridView}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <BrandIcon name="grid" size={15} />
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
