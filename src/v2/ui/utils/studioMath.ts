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
export function detectOverlayOverflow(
  overlay: OverlaySettings,
  photo: Photo,
  sizes: SizePreset[]
): OverlayOverflowIssue[] {
  if (!overlay.textEnabled || overlay.rows.length === 0) return [];

  const enabledSizes = sizes.filter((s) => s.enabled);
  const issues: OverlayOverflowIssue[] = [];

  for (const size of enabledSizes) {
    const aspect = size.width / Math.max(1, size.height);
    // Reference preview frame width in CSS px for a ~460px tall stage
    const refHeight = 460;
    const refWidth = Math.min(680, Math.max(240, Math.round(refHeight * aspect)));
    const safeWidth =
      overlay.textLayoutMode === 'cover-full' ? refWidth * 0.92 : refWidth * 0.82;
    const safeHeight =
      overlay.textLayoutMode === 'cover-full' ? refHeight * 0.88 : refHeight * 0.45;

    let maxRowWidth = 0;
    let totalHeight = 0;

    for (const row of overlay.rows) {
      const text = formatOverlayRowText(row, photo);
      const charFactor = row.uppercase ? 0.64 : 0.56;
      const estimatedWidth =
        text.length * (row.sizePx * charFactor + Math.max(0, row.letterSpacing));
      if (estimatedWidth > maxRowWidth) maxRowWidth = estimatedWidth;
      totalHeight += row.sizePx * 1.45;
    }

    const offsetMarginX = Math.abs(overlay.textOffsetX) * 0.01 * refWidth;
    const offsetMarginY = Math.abs(overlay.textOffsetY) * 0.01 * refHeight;

    if (maxRowWidth + offsetMarginX > safeWidth) {
      issues.push({
        sizeId: size.id,
        sizeLabel: size.label,
        reason: `Text width exceeds ${size.ratioLabel} safe margins`,
      });
    } else if (totalHeight + offsetMarginY > safeHeight) {
      issues.push({
        sizeId: size.id,
        sizeLabel: size.label,
        reason: `Text height crowds ${size.ratioLabel} vertical bounds`,
      });
    }
  }

  return issues;
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
  filter: 'all' | 'flagged',
  search: string
): Photo[] {
  const q = search.trim().toLowerCase();
  return photos.filter((photo) => {
    if (filter === 'flagged' && photo.decision !== 'keep') return false;
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
  threshold = 3.2
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
