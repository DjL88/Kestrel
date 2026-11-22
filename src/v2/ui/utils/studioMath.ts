// Pure logic helpers for InFlight UI shell (unit-tested with node:test).
// Zero DOM, zero network, zero canvas pixel processing.

import type {
  CropTransform,
  EditGroup,
  EditRecipe,
  LookPreset,
  OverlaySettings,
  OverlayTextRow,
  Photo,
  SizePreset,
} from '../contract';

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
  const tokens: string[] = [];
  for (const field of row.fields) {
    switch (field) {
      case 'camera':
        tokens.push(photo.exif.camera);
        break;
      case 'lens':
        tokens.push(photo.exif.lens);
        break;
      case 'aperture':
        tokens.push(photo.exif.aperture);
        break;
      case 'shutter':
        tokens.push(photo.exif.shutter);
        break;
      case 'iso':
        tokens.push(`ISO ${photo.exif.iso}`);
        break;
      case 'focalLength':
        tokens.push(photo.exif.focalLength);
        break;
      case 'species':
        if (photo.speciesLabel) tokens.push(photo.speciesLabel);
        break;
      case 'custom':
        if (row.customText.trim()) tokens.push(row.customText.trim());
        break;
    }
  }
  const joined = tokens.join('  ·  ');
  return row.uppercase ? joined.toUpperCase() : joined;
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

export function detectOverlayOverflow(
  overlay: OverlaySettings,
  photo: Photo,
  sizes: SizePreset[]
): OverlayOverflowIssue[] {
  if (!overlay.textEnabled || overlay.rows.length === 0) return [];
  const safeWidth = overlay.textLayoutMode === 'cover-full' ? 92 : 84; // % of the frame's width (less the box's padding)
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

/** The rows scaled down together, just enough for the widest to fit inside the safe width. Unchanged when it already fits. */
export function fitOverlayRows(overlay: OverlaySettings, photo: Photo): OverlayTextRow[] {
  const safeWidth = (overlay.textLayoutMode === 'cover-full' ? 92 : 84) - Math.abs(overlay.textOffsetX);
  const widest = Math.max(...overlay.rows.map((row) => rowWidthPercent(row, formatOverlayRowText(row, photo))));
  if (!(widest > safeWidth) || safeWidth <= 0) return overlay.rows;
  const factor = safeWidth / widest;
  return overlay.rows.map((row) => ({ ...row, sizePx: Math.max(8, Math.floor(row.sizePx * factor)) }));
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
 * Filters filmstrip / grid photos by All/Flagged and text search across filename, title, species, camera.
 */
export function filterPhotos(
  photos: Photo[],
  filter: 'all' | 'flagged' | 'set-aside',
  search: string
): Photo[] {
  const q = search.trim().toLowerCase();
  return photos.filter((photo) => {
    if (filter === 'flagged' && photo.decision !== 'keep') return false;
    if (filter === 'set-aside' && photo.decision !== 'reject') return false;
    if (!q) return true;
    const haystack = [
      photo.filename,
      photo.title,
      photo.speciesLabel ?? '',
      photo.category,
      photo.exif.camera,
      photo.exif.lens,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
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

  const xTargets: Array<{ value: number; label: string }> = [
    { value: 8, label: 'Left safe margin' },
    { value: 50, label: 'Centre X' },
    { value: 92, label: 'Right safe margin' },
  ];
  const yTargets: Array<{ value: number; label: string }> = [
    { value: 8, label: 'Top safe margin' },
    { value: 50, label: 'Centre Y' },
    { value: 92, label: 'Bottom safe margin' },
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
    const xFor = (leftEdge: number) => leftEdge / Math.max(0.01, 1 - box.w / 100);
    const yFor = (topEdge: number) => topEdge / Math.max(0.01, 1 - box.h / 100);
    xTargets.push({ value: xFor(8), label: 'Left margin' }, { value: (92 - box.w) / Math.max(0.01, 1 - box.w / 100), label: 'Right margin' });
    yTargets.push({ value: yFor(8), label: 'Top margin' }, { value: (92 - box.h) / Math.max(0.01, 1 - box.h / 100), label: 'Bottom margin' });
    if (peer) {
      xTargets.push(
        { value: xFor(peer.right + gap.x), label: 'Space beside' },
        { value: (peer.left - gap.x - box.w) / Math.max(0.01, 1 - box.w / 100), label: 'Space beside' },
        { value: xFor(peer.left), label: 'Edges aligned' }
      );
      yTargets.push(
        { value: yFor(peer.bottom + gap.y), label: 'Space below' },
        { value: (peer.top - gap.y - box.h) / Math.max(0.01, 1 - box.h / 100), label: 'Space above' },
        { value: yFor(peer.top), label: 'Edges aligned' }
      );
    }
  }

  let bestX = xClamped;
  let bestXGuide: SnapGuide | null = null;
  let minDx = threshold;
  for (const t of xTargets) {
    const d = Math.abs(xClamped - t.value);
    if (d <= minDx) {
      minDx = d;
      bestX = t.value;
      bestXGuide = { axis: 'x', percent: t.value, label: t.label };
    }
  }

  let bestY = yClamped;
  let bestYGuide: SnapGuide | null = null;
  let minDy = threshold;
  for (const t of yTargets) {
    const d = Math.abs(yClamped - t.value);
    if (d <= minDy) {
      minDy = d;
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
