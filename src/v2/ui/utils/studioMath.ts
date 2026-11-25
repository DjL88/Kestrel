// Pure logic helpers for InFlight UI shell (unit-tested with node:test).
// Zero DOM, zero network, zero canvas pixel processing.

import type {
  CropTransform,
  EditGroup,
  EditRecipe,
  FilmstripFilter,
  LookPreset,
  OverlaySettings,
  OverlayTextRow,
  Photo,
  PhotoSort,
  SizePreset,
} from '../contract';
import { composeOverlayText } from './overlayMetadata';
import { TAG_FACETS, type TagFacet } from '../../../core/photoTags';

export function getActiveGroup(photo: Photo): EditGroup {
  return (
    photo.editGroups.find((g) => g.id === photo.activeGroupId) ??
    photo.editGroups[0]
  );
}

/**
 * Resolves the effective preview EditRecipe when hovering a Curated Look.
 */
export function resolveEffectiveRecipe(
  base: EditRecipe,
  hoveredLook: LookPreset | null
): EditRecipe {
  if (!hoveredLook) return base;
  return {
    ...base,
    ...hoveredLook.recipeDelta,
    lookId: hoveredLook.id,
  };
}

/**
 * Pure CSS filter approximation of an EditRecipe for fast non-canvas UI preview.
 * Handles up to ±5 EV stops of exposure cleanly with gentle roll-off.
 */
export function buildPreviewFilterCss(
  recipe: EditRecipe,
  hoveredLook?: LookPreset | null
): string {
  const effective = resolveEffectiveRecipe(recipe, hoveredLook ?? null);

  // Soft curve for ±5 EV stops so extremes remain legible in CSS preview
  const exposureScale = Math.pow(2, effective.exposure * 0.28);
  const toneLift = 1 + (effective.shadows * 0.14 - effective.highlights * 0.08 + effective.whites * 0.06) / 100;
  const brightness = clamp(exposureScale * toneLift, 0.25, 2.4);

  const contrast = clamp(
    1 + (effective.contrast * 0.42 + effective.clarity * 0.16 - effective.blacks * 0.12) / 100,
    0.45,
    1.85
  );

  const saturate = clamp(
    1 + (effective.saturation * 0.65 + effective.vibrance * 0.35) / 100,
    0,
    2.2
  );

  const sepia = effective.temperature > 0 ? clamp((effective.temperature / 100) * 0.28, 0, 0.32) : 0;
  const hueRotate = Math.round(effective.tint * 0.22 + (effective.temperature < 0 ? effective.temperature * 0.14 : 0));

  const parts = [
    `brightness(${brightness.toFixed(3)})`,
    `contrast(${contrast.toFixed(3)})`,
    `saturate(${saturate.toFixed(3)})`,
  ];
  if (sepia > 0.005) parts.push(`sepia(${sepia.toFixed(3)})`);
  if (hueRotate !== 0) parts.push(`hue-rotate(${hueRotate}deg)`);

  return parts.join(' ');
}

/**
 * Renders a single OverlayTextRow using photo EXIF & species metadata.
 */
export function formatOverlayRowText(row: OverlayTextRow, photo: Photo): string {
  return composeOverlayText(row, photo);
}

export interface OverlayOverflowIssue {
  sizeId: string;
  sizeLabel: string;
  reason: string;
}

/**
 * Estimates whether the active multi-row text overlay overflows any enabled format frame.
 * Used to raise a calm, actionable issue flag in both the Overlays panel and Canvas header.
 */
const REFERENCE_FRAME_WIDTH = 660;
const LINE_HEIGHT = 1.375;

/** How wide a row of text is, as a share of the frame's width. Overlay sizes are a share of the frame's width, so this is the
 * same in every format; it is an estimate from the number of characters (the real width depends on the font). */
export function rowWidthPercent(row: OverlayTextRow, text: string): number {
  const charFactor = row.uppercase ? 0.64 : 0.56;
  const pixels = text.length * (row.sizePx * charFactor + Math.max(0, row.letterSpacing));
  return (pixels / REFERENCE_FRAME_WIDTH) * 100;
}

/** The share of the frame's width a text box's words may use: the frame less both edge margins and the box's own padding. */
export function safeTextWidth(overlay: Pick<OverlaySettings, 'textLayoutMode' | 'edgeMargin'>): number {
  if (overlay.textLayoutMode === 'cover-full') return 92;
  const margin = Number.isFinite(overlay.edgeMargin) ? overlay.edgeMargin : 4;
  return Math.max(10, 100 - 2 * margin - (2 * 12 * 100) / REFERENCE_FRAME_WIDTH);
}

/** The largest size (reference pixels) a row can have before its words run past the safe width. Never below 8. */
export function maxRowSizePx(row: OverlayTextRow, photo: Photo, overlay: Pick<OverlaySettings, 'textLayoutMode' | 'edgeMargin'>, ceiling = 120): number {
  const text = formatOverlayRowText(row, photo);
  if (!text) return ceiling;
  const spacing = (text.length * Math.max(0, row.letterSpacing) * 100) / REFERENCE_FRAME_WIDTH;
  const perPx = rowWidthPercent({ ...row, sizePx: 1, letterSpacing: 0 }, text);
  if (!(perPx > 0)) return ceiling;
  return Math.max(8, Math.min(ceiling, Math.floor((safeTextWidth(overlay) - spacing) / perPx)));
}

/** The row with its size brought down to fit the frame, when a change (more fields, capitals, a bigger size) made it too wide. */
export function capRowSize(row: OverlayTextRow, photo: Photo, overlay: Pick<OverlaySettings, 'textLayoutMode' | 'edgeMargin'>): OverlayTextRow {
  const most = maxRowSizePx(row, photo, overlay);
  return row.sizePx > most ? { ...row, sizePx: most } : row;
}

export function detectOverlayOverflow(
  overlay: OverlaySettings,
  photo: Photo,
  sizes: SizePreset[]
): OverlayOverflowIssue[] {
  if (!overlay.textEnabled || overlay.rows.length === 0) return [];
  const safeWidth = safeTextWidth(overlay); // % of the frame's width (less the margins and the box's padding)
  const widest = Math.max(...overlay.rows.map((row) => rowWidthPercent(row, formatOverlayRowText(row, photo))));
  const issues: OverlayOverflowIssue[] = [];
  for (const size of sizes.filter((s) => s.enabled)) {
    const frameShape = size.width / Math.max(1, size.height); // frame width over frame height
    // Height as a share of the frame's height: the same text is a bigger share of a wide, short frame.
    const heightPercent = overlay.rows.reduce((sum, row) => sum + (row.sizePx * LINE_HEIGHT) / REFERENCE_FRAME_WIDTH, 0) * 100 * frameShape;
    const safeHeight = overlay.textLayoutMode === 'cover-full' ? 88 : 45;
    if (widest + Math.abs(overlay.textOffsetX) > safeWidth) {
      issues.push({ sizeId: size.id, sizeLabel: size.label, reason: `The widest row is about ${Math.round(widest)}% of the frame's width` });
    } else if (heightPercent + Math.abs(overlay.textOffsetY) > safeHeight) {
      issues.push({ sizeId: size.id, sizeLabel: size.label, reason: `The text is about ${Math.round(heightPercent)}% of the frame's height in ${size.ratioLabel}` });
    }
  }
  return issues;
}

/** Fit the estimated width and height of every enabled format, preserving row proportions where the minimum permits. */
export function fitOverlayRows(overlay: OverlaySettings, photo: Photo, sizes: SizePreset[] = photo.sizes ?? []): OverlayTextRow[] {
  if (!overlay.rows.length) return overlay.rows;
  const full = overlay.textLayoutMode === 'cover-full';
  const safeWidth = safeTextWidth(overlay) - Math.abs(overlay.textOffsetX || 0);
  const safeHeight = (full ? 88 : 45) - Math.abs(overlay.textOffsetY || 0);
  const widest = Math.max(...overlay.rows.map((row) => rowWidthPercent(row, formatOverlayRowText(row, photo))));
  const height = overlay.rows.reduce((sum, row) => sum + row.sizePx * LINE_HEIGHT / REFERENCE_FRAME_WIDTH, 0) * 100;
  const shapes = sizes.filter((size) => size.enabled && size.width > 0 && size.height > 0).map((size) => size.width / size.height);
  const tallest = height * Math.max(0, ...shapes);
  if (safeWidth <= 0 || safeHeight <= 0) return overlay.rows;
  const factor = Math.min(1, widest > 0 ? safeWidth / widest : 1, tallest > 0 ? safeHeight / tallest : 1);
  if (factor >= 1) return overlay.rows;
  return overlay.rows.map((row) => ({ ...row, sizePx: Math.max(8, Math.floor(row.sizePx * factor)), letterSpacing: Math.round(row.letterSpacing * factor * 10) / 10 }));
}

/**
 * Computes next multi-select ID array for single click, Ctrl/Cmd toggle, or Shift range.
 */
export function computeMultiSelection(
  orderedIds: string[],
  currentSelected: string[],
  anchorId: string | null,
  targetId: string,
  modifiers?: { ctrl?: boolean; shift?: boolean }
): string[] {
  if (modifiers?.shift && anchorId) {
    const startIdx = orderedIds.indexOf(anchorId);
    const endIdx = orderedIds.indexOf(targetId);
    if (startIdx !== -1 && endIdx !== -1) {
      const low = Math.min(startIdx, endIdx);
      const high = Math.max(startIdx, endIdx);
      return orderedIds.slice(low, high + 1);
    }
  }

  if (modifiers?.ctrl) {
    if (currentSelected.includes(targetId)) {
      const remaining = currentSelected.filter((id) => id !== targetId);
      return remaining.length > 0 ? remaining : [targetId];
    }
    return [...currentSelected, targetId];
  }

  return [targetId];
}

/**
 * Filters filmstrip / grid photos by decision (All, To review, Flagged, Set aside) and text search across filename, title, species, camera.
 */
export function filterPhotos(
  photos: Photo[],
  filter: FilmstripFilter,
  search: string,
  tagId?: string | null,
): Photo[] {
  const q = search.trim().toLowerCase();
  return photos.filter((photo) => {
    if (tagId && !photo.photoTags?.some((tag) => tag.id === tagId)) return false;
    if (filter === 'to-review' && photo.decision !== 'unreviewed') return false;
    if (filter === 'flagged' && photo.decision !== 'keep') return false;
    if (filter === 'set-aside' && photo.decision !== 'reject') return false;
    if (!q) return true;
    const haystack = [
      photo.filename,
      photo.title,
      photo.speciesLabel ?? '',
      photo.vehicleLabel ?? '',
      ...(photo.searchTerms ?? []),
      ...(photo.photoTags ?? []).flatMap((tag) => tag.words),
      photo.category,
      photo.exif.camera,
      photo.exif.lens,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}

const TIER_RANK: Record<string, number> = { best: 3, better: 2, good: 1 };

/**
 * Orders photos for display. The sort is stable and falls back to shoot order, so photos with no capture time,
 * no rating or no ranking keep their place rather than being guessed into one.
 */
export function sortPhotos(photos: Photo[], sort: PhotoSort): Photo[] {
  if (sort === 'shoot') return photos;
  const indexed = photos.map((photo, index) => ({ photo, index }));
  const captured = (photo: Photo) => (typeof photo.capturedAtMs === 'number' && Number.isFinite(photo.capturedAtMs) ? photo.capturedAtMs : null);
  const compare = (a: Photo, b: Photo): number => {
    switch (sort) {
      case 'captured-oldest':
      case 'captured-newest': {
        const ta = captured(a);
        const tb = captured(b);
        if (ta === null || tb === null) return ta === null && tb === null ? 0 : ta === null ? 1 : -1;
        return sort === 'captured-oldest' ? ta - tb : tb - ta;
      }
      case 'filename':
        return a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' });
      case 'rating':
        return b.rating - a.rating;
      case 'best':
        return (TIER_RANK[b.tier ?? ''] ?? 0) - (TIER_RANK[a.tier ?? ''] ?? 0) || b.rating - a.rating;
      default:
        return 0;
    }
  };
  return indexed.sort((x, y) => compare(x.photo, y.photo) || x.index - y.index).map((entry) => entry.photo);
}

/** What the filmstrip and grid show: decision filter, search, minimum rating, then the chosen order. */
export function viewPhotos(
  photos: Photo[],
  view: { filter: FilmstripFilter; search: string; minRating: number; sort: PhotoSort; tag?: string | null }
): Photo[] {
  const filtered = filterPhotos(photos, view.filter, view.search, view.tag).filter((photo) => photo.rating >= view.minRating);
  return sortPhotos(filtered, view.sort);
}

/** The tags some photo has, grouped by kind in a fixed order, each with how many photos have it, for the tag filter. */
export function tagChoices(photos: readonly Photo[]): { facet: TagFacet; tags: { id: string; label: string; count: number }[] }[] {
  const byId = new Map<string, { id: string; facet: TagFacet; label: string; count: number }>();
  for (const photo of photos) {
    for (const tag of photo.photoTags ?? []) {
      const entry = byId.get(tag.id);
      if (entry) entry.count += 1;
      else byId.set(tag.id, { id: tag.id, facet: tag.facet, label: tag.label, count: 1 });
    }
  }
  return TAG_FACETS.map((facet) => ({
    facet,
    tags: [...byId.values()].filter((tag) => tag.facet === facet).sort((a, b) => a.label.localeCompare(b.label))
      .map(({ id, label, count }) => ({ id, label, count })),
  })).filter((group) => group.tags.length > 0);
}

export function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export interface SnapGuide {
  axis: 'x' | 'y';
  percent: number;
  label: string;
}

/** What the dragged box and its neighbour really occupy, in % of the frame, so edges, centre and gaps can be snapped exactly. */
export interface SnapGeometry {
  box: { w: number; h: number };
  peer?: { left: number; right: number; top: number; bottom: number } | null;
  /** The space to leave between overlays, in % of the frame (a quarter of one text row's height). */
  gap: { x: number; y: number };
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

/**
 * Computes suggested-snapping positions for dragging Text Overlay or Watermark.
 * Snaps to frame safe margins (8%, 92%), frame centre (50%), thirds (33.3%, 66.7%),
 * and aligns to the peer overlay's X/Y edge or clean visual spacing (±12% vertical rhythm).
 */
export function snapOverlayPosition(
  rawX: number,
  rawY: number,
  peer: { x: number; y: number; visible: boolean },
  snapEnabled: boolean,
  threshold = 3.2,
  geometry?: SnapGeometry
): SnapResult {
  const xClamped = clamp(rawX, 5, 95);
  const yClamped = clamp(rawY, 6, 94);
  if (!snapEnabled) {
    return { x: Number(xClamped.toFixed(1)), y: Number(yClamped.toFixed(1)), guides: [] };
  }

  // Without measured box geometry, retain the legacy point-based safe margins.
  // With geometry, safe margins must be measured at the box edges, not its centre.
  const xTargets: Array<{ value: number; label: string }> = [
    ...(!geometry ? [{ value: 8, label: 'Left safe margin' }, { value: 92, label: 'Right safe margin' }] : []),
    { value: 50, label: 'Centre X' },
  ];
  const yTargets: Array<{ value: number; label: string }> = [
    ...(!geometry ? [{ value: 8, label: 'Top safe margin' }, { value: 92, label: 'Bottom safe margin' }] : []),
    { value: 50, label: 'Centre Y' },
  ];

  if (peer.visible) {
    xTargets.push(
      { value: peer.x, label: 'Aligned with overlay' },
      { value: clamp(100 - peer.x, 8, 92), label: 'Mirrored margin' }
    );
    yTargets.push(
      { value: peer.y, label: 'Baseline aligned' },
      { value: clamp(peer.y - 12, 8, 92), label: 'Spaced above' },
      { value: clamp(peer.y + 12, 8, 92), label: 'Spaced below' }
    );
  }

  // A box is placed by an anchor that moves smoothly from its left edge (0%) to its right edge (100%), so the centre is exactly
  // 50%. With the box's real size, its edges and the gap to the other overlay can be snapped exactly too.
  if (geometry) {
    const { box, peer, gap } = geometry;
    // The stored position is the box centre, not a moving left/right anchor.
    // Express edge and peer alignment targets in centre coordinates so crossing
    // 35% or 65% never changes the physical point being dragged.
    const xFor = (leftEdge: number) => leftEdge + box.w / 2;
    const yFor = (topEdge: number) => topEdge + box.h / 2;
    xTargets.push({ value: xFor(8), label: 'Left margin' }, { value: xFor(92 - box.w), label: 'Right margin' });
    yTargets.push({ value: yFor(8), label: 'Top margin' }, { value: yFor(92 - box.h), label: 'Bottom margin' });
    if (peer) {
      xTargets.push(
        { value: xFor(peer.right + gap.x), label: 'Space beside' },
        { value: xFor(peer.left - gap.x - box.w), label: 'Space beside' },
        { value: xFor(peer.left), label: 'Edges aligned' }
      );
      yTargets.push(
        { value: yFor(peer.bottom + gap.y), label: 'Space below' },
        { value: yFor(peer.top - gap.y - box.h), label: 'Space above' },
        { value: yFor(peer.top), label: 'Edges aligned' }
      );
    }
  }

  // A target only replaces the current best when it is strictly closer than the best found so far: on an
  // exact tie (two targets the same distance away, e.g. a peer sitting right on the frame's safe margin)
  // the earlier, more fundamental target (safe margin, centre) keeps the guide label rather than whichever
  // peer-alignment target happens to be pushed last. `threshold` is the acceptance ceiling, independent of
  // the running best distance, so a later target outside the threshold can never register just because it
  // is the first one checked.
  let bestX = xClamped;
  let bestXGuide: SnapGuide | null = null;
  let bestXDist = Infinity;
  for (const t of xTargets) {
    const d = Math.abs(xClamped - t.value);
    if (d <= threshold && d < bestXDist) {
      bestXDist = d;
      bestX = t.value;
      bestXGuide = { axis: 'x', percent: t.value, label: t.label };
    }
  }

  let bestY = yClamped;
  let bestYGuide: SnapGuide | null = null;
  let bestYDist = Infinity;
  for (const t of yTargets) {
    const d = Math.abs(yClamped - t.value);
    if (d <= threshold && d < bestYDist) {
      bestYDist = d;
      bestY = t.value;
      bestYGuide = { axis: 'y', percent: t.value, label: t.label };
    }
  }

  const guides: SnapGuide[] = [];
  if (bestXGuide) guides.push(bestXGuide);
  if (bestYGuide) guides.push(bestYGuide);

  return {
    x: Number(bestX.toFixed(1)),
    y: Number(bestY.toFixed(1)),
    guides,
  };
}

/**
 * Generates deterministic RGB + Luminance histogram bins (32 bins, 0..100)
 * responsive to the active EditRecipe — pure math, zero canvas pixel access.
 */
export function buildHistogramData(recipe: EditRecipe, seed = 1): {
  luma: number[];
  red: number[];
  green: number[];
  blue: number[];
} {
  const bins = 32;
  const shift = recipe.exposure * 3.4 + (recipe.shadows - recipe.highlights) * 0.03;
  const spread = clamp(1 + recipe.contrast * 0.0045, 0.65, 1.55);
  const warmShift = recipe.temperature * 0.05;
  const tintShift = recipe.tint * 0.04;

  const luma: number[] = [];
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];

  const peakA = 11 + (seed % 4) + shift;
  const peakB = 22 - (seed % 3) + shift;

  for (let i = 0; i < bins; i++) {
    const g = (center: number, width: number) =>
      Math.exp(-Math.pow((i - center) / (width * spread), 2));
    const baseVal = 68 * g(peakA, 4.6) + 52 * g(peakB, 5.2) + 12 * g(16 + shift, 8);
    const l = clamp(Math.round(baseVal), 4, 98);
    const r = clamp(Math.round(baseVal * (1 + warmShift * 0.14) * g(peakA + warmShift, 6.2) * 0.4 + l * 0.72), 4, 98);
    const gr = clamp(Math.round(l * (1 - tintShift * 0.06)), 4, 98);
    const b = clamp(Math.round(l * (1 - warmShift * 0.14)), 4, 98);

    luma.push(l);
    red.push(r);
    green.push(gr);
    blue.push(b);
  }

  return { luma, red, green, blue };
}


export interface OutputSize {
  /** What the format will really be, in pixels. Never more than the picture has. */
  width: number;
  height: number;
  /** True when the format asked for more pixels than the picture has, so it was reduced (never enlarged). */
  capped: boolean;
  requestedWidth: number;
  requestedHeight: number;
}

/**
 * A format's real output size. A format never asks the picture for more pixels than it has: 3000 x 2000 on a picture that is
 * 1500 pixels wide becomes 1500 x 1000, keeping the format's shape, and says so (`capped`). The picture is fitted to the
 * format's shape first (the part of it the format shows), then the crop zoom and edge insets are taken off. With no known
 * picture size nothing is capped: the format's own size is returned.
 */
export function effectiveOutputSize(
  size: { width: number; height: number; crop?: Pick<CropTransform, 'zoom' | 'insetTop' | 'insetRight' | 'insetBottom' | 'insetLeft'> },
  pixelSize: { width: number; height: number } | undefined,
): OutputSize {
  const requested = { requestedWidth: size.width, requestedHeight: size.height };
  if (!pixelSize || !(pixelSize.width > 0) || !(pixelSize.height > 0) || !(size.width > 0) || !(size.height > 0)) {
    return { width: size.width, height: size.height, capped: false, ...requested };
  }
  const aspect = size.width / size.height;
  // The largest piece of the picture with the format's shape.
  let usableWidth = pixelSize.width / pixelSize.height >= aspect ? pixelSize.height * aspect : pixelSize.width;
  const crop = size.crop;
  if (crop) {
    const widthShare = 1 - (crop.insetLeft + crop.insetRight) / 100;
    const heightShare = 1 - (crop.insetTop + crop.insetBottom) / 100;
    usableWidth *= Math.max(0.01, Math.min(widthShare, heightShare)) / Math.max(1, crop.zoom);
  }
  if (usableWidth >= size.width - 0.5) return { width: size.width, height: size.height, capped: false, ...requested };
  const width = Math.max(1, Math.round(usableWidth));
  return { width, height: Math.max(1, Math.round(width / aspect)), capped: true, ...requested };
}

/** The chosen scale is used only when requested pixels need it and the enlarged source fits the device. */
export function upscaleFactorFor(chosen: 1 | 2 | 4 | undefined, neededScale: number, width: number, height: number, pixelLimit: number): 1 | 2 | 4 {
  if ((chosen !== 2 && chosen !== 4) || !(neededScale > 1)) return 1;
  return width * height * chosen * chosen <= pixelLimit ? chosen : 1;
}

/** Shared canvas/export dimensions. Keep fixed format sizes fixed; upscale lifts the source cap, not the requested size. */
export function effectiveUpscaleOutputSize(
  size: Parameters<typeof effectiveOutputSize>[0],
  pixelSize: Parameters<typeof effectiveOutputSize>[1],
  chosen: 1 | 2 | 4 | undefined,
  pixelLimit: number,
): OutputSize & { factor: 1 | 2 | 4 } {
  const factor = pixelSize && pixelSize.width > 0 && pixelSize.height > 0
    ? upscaleFactorFor(chosen, Math.max(size.width / pixelSize.width, size.height / pixelSize.height) * (size.crop?.zoom ?? 1), pixelSize.width, pixelSize.height, pixelLimit)
    : 1;
  const source = pixelSize ? { width: pixelSize.width * factor, height: pixelSize.height * factor } : undefined;
  return { ...effectiveOutputSize(size, source), factor };
}

/** Bounds for moving the source under one format's fixed-aspect crop window.
 * Always use the format being dragged, not the currently selected format.
 * Values are percentages of the format frame; a source with unknown dimensions
 * uses the preview's 3:2 assumption, never claims measured source geometry.
 */
export function cropPanLimits(
  pixelSize: { width: number; height: number } | undefined,
  size: Pick<SizePreset, 'width' | 'height'>,
  zoom: number
): { x: number; y: number } {
  const sourceAspect = pixelSize && pixelSize.width > 0 && pixelSize.height > 0
    ? pixelSize.width / pixelSize.height : 3 / 2;
  const frameAspect = size.width > 0 && size.height > 0 ? size.width / size.height : sourceAspect;
  const safeZoom = Number.isFinite(zoom) ? Math.max(1, zoom) : 1;
  const widthRatio = sourceAspect > frameAspect ? (sourceAspect / frameAspect) * safeZoom : safeZoom;
  const heightRatio = sourceAspect > frameAspect ? safeZoom : (frameAspect / sourceAspect) * safeZoom;
  return { x: Math.max(0, (widthRatio - 1) / 2) * 100, y: Math.max(0, (heightRatio - 1) / 2) * 100 };
}
