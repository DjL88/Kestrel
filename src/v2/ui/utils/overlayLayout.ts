import type { OverlayAnchor, OverlaySettings } from '../contract';

/**
 * Where the text box and the watermark sit in a frame. One rule, used by the canvas (as CSS) and by the export (as pixels),
 * so the file looks the way the canvas showed it.
 *
 * An anchored box ('top-left', 'bottom-center', …) has its EDGE at the edge margin: the top of a top box is one margin below
 * the frame's top, the bottom of a bottom box one margin above the frame's bottom, and the same on the left and right. The
 * margin is a share of the frame's width, so it is the same distance on every side. When the text and the watermark share an
 * anchor they stack (watermark first, then the text) instead of sitting on top of each other.
 *
 * A dragged ('free') box keeps its centre where it was dropped, moved in just enough to stay inside the margins.
 */
export interface Box { x: number; y: number; width: number; height: number }

export const ANCHORS: readonly OverlayAnchor[] = ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];

export const DEFAULT_EDGE_MARGIN = 4;
/** Space between a stacked watermark and text, in reference pixels (a 660 px wide frame), like every overlay size. */
export const STACK_GAP_PX = 6;

export function anchorParts(anchor: OverlayAnchor): { row: 'top' | 'middle' | 'bottom'; column: 'left' | 'center' | 'right' } {
  const [row, column] = anchor.split('-') as ['top' | 'middle' | 'bottom', 'left' | 'center' | 'right'];
  return { row, column };
}

/** The centre of an anchored box as % of the frame, for older code that still reads textX/textY. An estimate: the real
 * place depends on the box's size, which only the layout knows. */
export function anchorCentre(anchor: OverlayAnchor): { x: number; y: number } {
  const { row, column } = anchorParts(anchor);
  return { x: column === 'left' ? 10 : column === 'right' ? 90 : 50, y: row === 'top' ? 8 : row === 'bottom' ? 92 : 50 };
}

const clamp = (value: number, min: number, max: number) => (max < min ? (min + max) / 2 : Math.min(max, Math.max(min, value)));

function placeAnchored(frame: { width: number; height: number }, anchor: OverlayAnchor, margin: number, size: { width: number; height: number }) {
  const { row, column } = anchorParts(anchor);
  const x = column === 'left' ? margin : column === 'right' ? frame.width - margin - size.width : (frame.width - size.width) / 2;
  const y = row === 'top' ? margin : row === 'bottom' ? frame.height - margin - size.height : (frame.height - size.height) / 2;
  // A box wider or taller than the room inside the margins is centred, so neither edge is lost more than the other.
  return { x: clamp(x, 0, frame.width - size.width), y: clamp(y, 0, frame.height - size.height) };
}

function placeFree(frame: { width: number; height: number }, centreX: number, centreY: number, margin: number, size: { width: number; height: number }) {
  const x = (centreX / 100) * frame.width - size.width / 2;
  const y = (centreY / 100) * frame.height - size.height / 2;
  return { x: clamp(x, margin, frame.width - margin - size.width), y: clamp(y, margin, frame.height - margin - size.height) };
}

/** The anchor's column decides how a box's contents line up, so stacked boxes share one edge. */
export const alignForAnchor = (anchor: OverlayAnchor): 'left' | 'center' | 'right' => anchorParts(anchor).column;

/** True when the text and the watermark are both anchored to the same place, and so are drawn as one stack. */
export function stacked(overlay: Pick<OverlaySettings, 'textPlacement' | 'watermarkPlacement' | 'textPosition' | 'watermarkPosition'>, both: boolean): boolean {
  return both && overlay.textPlacement === 'anchor' && overlay.watermarkPlacement === 'anchor' && overlay.textPosition === overlay.watermarkPosition;
}

/**
 * The text box and watermark box in a frame of `frame` pixels. `k` turns reference pixels into the frame's pixels
 * (frame width / 660). Give only the boxes that are drawn.
 */
export function layoutOverlays(
  frame: { width: number; height: number },
  overlay: Pick<OverlaySettings, 'textPlacement' | 'watermarkPlacement' | 'textPosition' | 'watermarkPosition' | 'textX' | 'textY' | 'watermarkX' | 'watermarkY' | 'edgeMargin'>,
  sizes: { text?: { width: number; height: number }; mark?: { width: number; height: number } },
  k: number,
): { text?: Box; mark?: Box } {
  const margin = ((Number.isFinite(overlay.edgeMargin) ? overlay.edgeMargin : DEFAULT_EDGE_MARGIN) / 100) * frame.width;
  const out: { text?: Box; mark?: Box } = {};
  if (sizes.text && sizes.mark && stacked(overlay, true)) {
    const gap = STACK_GAP_PX * k;
    const group = { width: Math.max(sizes.text.width, sizes.mark.width), height: sizes.text.height + gap + sizes.mark.height };
    const at = placeAnchored(frame, overlay.textPosition, margin, group);
    const column = anchorParts(overlay.textPosition).column;
    const inGroup = (width: number) => (column === 'left' ? 0 : column === 'right' ? group.width - width : (group.width - width) / 2);
    out.mark = { x: at.x + inGroup(sizes.mark.width), y: at.y, ...sizes.mark };
    out.text = { x: at.x + inGroup(sizes.text.width), y: at.y + sizes.mark.height + gap, ...sizes.text };
    return out;
  }
  if (sizes.text) {
    const at = overlay.textPlacement === 'anchor' ? placeAnchored(frame, overlay.textPosition, margin, sizes.text) : placeFree(frame, overlay.textX, overlay.textY, margin, sizes.text);
    out.text = { ...at, ...sizes.text };
  }
  if (sizes.mark) {
    const at = overlay.watermarkPlacement === 'anchor' ? placeAnchored(frame, overlay.watermarkPosition, margin, sizes.mark) : placeFree(frame, overlay.watermarkX, overlay.watermarkY, margin, sizes.mark);
    out.mark = { ...at, ...sizes.mark };
  }
  return out;
}

/** CSS for an anchored stack on the canvas: a box filling the frame inside the margin, lining its children up at the anchor. */
export function anchorFlexStyle(anchor: OverlayAnchor, marginCqw: string): { padding: string; justifyContent: string; alignItems: string } {
  const { row, column } = anchorParts(anchor);
  const edge = (part: string) => (part === 'top' || part === 'left' ? 'flex-start' : part === 'bottom' || part === 'right' ? 'flex-end' : 'center');
  return { padding: marginCqw, justifyContent: edge(row), alignItems: edge(column) };
}

/** CSS for a dragged box on the canvas (inside a `container-type: size` layer): centred on (x%, y%), then held inside the
 * edge margin exactly as `layoutOverlays` holds it, so the preview and the export agree. */
export function freeTransform(xPercent: number, yPercent: number, edgeMargin: number): string {
  const m = Number.isFinite(edgeMargin) ? edgeMargin : DEFAULT_EDGE_MARGIN;
  const x = `clamp(calc(${m - xPercent}cqw), -50%, calc(${100 - m - xPercent}cqw - 100%))`;
  const y = `clamp(calc(${m}cqw - ${yPercent}cqh), -50%, calc(100cqh - ${m}cqw - ${yPercent}cqh - 100%))`;
  return `translate(${x}, ${y})`;
}
