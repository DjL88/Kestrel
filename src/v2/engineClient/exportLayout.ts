import type { CropTransform, OverlaySettings } from '../ui/contract';

/** The canvas lays overlays out in a 660 px wide reference frame (cqw units), so export scales every size by width / 660. */
export const REFERENCE_FRAME_WIDTH = 660;
export const referenceScale = (frameWidth: number) => frameWidth / REFERENCE_FRAME_WIDTH;

export interface Rect { x: number; y: number; width: number; height: number }

/**
 * How the picture is placed in an output of `width` x `height`, mirroring the canvas: the picture covers the frame, then
 * `translate(pan%) rotate(deg) scale(zoom, flip)` about the frame centre, and the edge insets clip the frame.
 * Rotations are whole turns, so a quarter turn swaps the picture's sides before it is covered.
 */
export function cropPlacement(width: number, height: number, picture: { width: number; height: number }, crop: CropTransform) {
  const quarter = crop.rotateDeg === 90 || crop.rotateDeg === 270;
  // The cover fit is done by the browser on the unrotated element, then the element is rotated, so it uses the unrotated sides.
  const cover = Math.max(width / picture.width, height / picture.height);
  return {
    drawWidth: picture.width * cover,
    drawHeight: picture.height * cover,
    translateX: (crop.panX / 100) * width,
    translateY: (crop.panY / 100) * height,
    rotateRad: (crop.rotateDeg * Math.PI) / 180,
    scaleX: (crop.flipH ? -1 : 1) * crop.zoom,
    scaleY: (crop.flipV ? -1 : 1) * crop.zoom,
    clip: {
      x: (crop.insetLeft / 100) * width, y: (crop.insetTop / 100) * height,
      width: Math.max(1, width * (1 - (crop.insetLeft + crop.insetRight) / 100)),
      height: Math.max(1, height * (1 - (crop.insetTop + crop.insetBottom) / 100)),
    } satisfies Rect,
    quarter,
  };
}

/** Where a box sits when the canvas anchors it at (x%, y%): `left: X%` with `translate(-50%, -50%)`, so the
 * box's own centre - not one of its edges - sits at (x%, y%) of the frame. This must mirror Canvas.tsx's
 * fixed-centre transform exactly, or the exported image places text/watermark somewhere other than where
 * the canvas showed it (the saved X% is the centre's position either way; only the offset used to go from
 * that centre to the box's top-left corner changed, from an X%-scaled offset to a flat half-width one). */
export function anchoredBox(frame: { width: number; height: number }, xPercent: number, yPercent: number, box: { width: number; height: number }): Rect {
  return { x: (xPercent / 100) * frame.width - box.width / 2, y: (yPercent / 100) * frame.height - box.height / 2, width: box.width, height: box.height };
}

/** Leave a small page-relative margin even when a saved centre is near the edge. */
export const OVERLAY_SAFE_MARGIN = 4;
export function safeAnchoredBox(frame: { width: number; height: number }, xPercent: number, yPercent: number, box: { width: number; height: number }): Rect {
  const raw = anchoredBox(frame, xPercent, yPercent, box);
  const safe = (position: number, length: number, extent: number) => {
    const margin = extent * OVERLAY_SAFE_MARGIN / 100;
    return Math.max(margin, Math.min(extent - margin - length, position));
  };
  return { ...raw, x: safe(raw.x, raw.width, frame.width), y: safe(raw.y, raw.height, frame.height) };
}

/** CSS equivalent of safeAnchoredBox: translate relative to the box, using container units for the frame.
 * Scale is about the unscaled box centre; its rendered extent determines the margin. */
export function safeOverlayTransform(xPercent: number, yPercent: number, scale = 1): string {
  const axis = (p: number, unit: 'cqw' | 'cqh') =>
    `clamp(calc(${OVERLAY_SAFE_MARGIN - p}${unit} + ${(scale - 1) * 50}%), -50%, calc(${100 - OVERLAY_SAFE_MARGIN - p}${unit} - ${(scale + 1) * 50}%))`;
  return `translate(${axis(xPercent, 'cqw')}, ${axis(yPercent, 'cqh')}) scale(${scale})`;
}

/** The watermark box: anchored like text, then scaled about its own centre (`transform-origin: 50% 50%`), matching Canvas.tsx. */
export function watermarkBox(frame: { width: number; height: number }, overlay: Pick<OverlaySettings, 'watermarkX' | 'watermarkY' | 'watermarkScale'>, natural: { width: number; height: number }): Rect {
  const scale = overlay.watermarkScale / 100;
  return safeAnchoredBox(frame, overlay.watermarkX, overlay.watermarkY, { width: natural.width * scale, height: natural.height * scale });
}

/** Match the preview's contain box, without stretching panoramic or portrait artwork. */
export function fitWatermarkArtwork(frameWidth: number, naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  if (!(frameWidth > 0 && naturalWidth > 0 && naturalHeight > 0)) return { width: 0, height: 0 };
  const k = referenceScale(frameWidth);
  const scale = Math.min(180 * k / naturalWidth, 36 * k / naturalHeight);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}
