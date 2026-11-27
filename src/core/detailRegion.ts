/**
 * When the editor's picture is shown larger than it was drawn (zoomed in), which part of the full-resolution photo to
 * draw again, at what scale, and where it lies over the picture. Pure, so it is unit tested; the drawing is in
 * src/components/useDetailRegion.ts.
 */
export interface Rect { left: number; top: number; width: number; height: number }

export interface DetailPlan {
  /** The part of the framed photo to draw, in its full-resolution pixels. */
  region: { x: number; y: number; width: number; height: number };
  /** Drawn at this share of full resolution (1 = the photo's own pixels). */
  scale: number;
  /** The same part as shares (0 to 1) of the framed photo, for masks and the lens centre. */
  view: { x: number; y: number; w: number; h: number };
  /** Where it lies over the picture's box, as percentages of the box. */
  place: { left: number; top: number; width: number; height: number };
}

/** Only worth drawing when the picture is shown at least this much larger than it was drawn. */
export const DETAIL_GAIN = 1.15;
/** The full-resolution picture is "more detail" only when it has at least this many times the drawn picture's edge (a
 * 2,560 px screen develop under a 2,200 px drawing is not). */
export const DETAIL_SOURCE_GAIN = 1.5;
/** Room round what is visible, so a small pan does not show the softer picture at once. */
const MARGIN = 0.1;
/** A detail drawing is at most this size, whatever the screen (memory and time stay bounded). */
export const DETAIL_MAX_PIXELS = 12_000_000;
export const DETAIL_MAX_EDGE = 4096;

export function detailPlan(input: {
  box: Rect; visible: Rect; devicePixelRatio: number; renderedLongEdge: number;
  full: { width: number; height: number }; fit?: 'cover' | 'contain';
}): DetailPlan | null {
  const { box, visible, full } = input;
  const dpr = input.devicePixelRatio > 0 ? input.devicePixelRatio : 1;
  if (!(box.width > 0 && box.height > 0 && full.width > 0 && full.height > 0 && input.renderedLongEdge > 0)) return null;
  // The picture inside its box (object-fit), in screen pixels.
  const fitScale = (input.fit ?? 'cover') === 'cover'
    ? Math.max(box.width / full.width, box.height / full.height) : Math.min(box.width / full.width, box.height / full.height);
  const pictureW = full.width * fitScale, pictureH = full.height * fitScale;
  const pictureLeft = box.left + (box.width - pictureW) / 2, pictureTop = box.top + (box.height - pictureH) / 2;
  const shownLongEdge = Math.max(pictureW, pictureH) * dpr;
  const fullLongEdge = Math.max(full.width, full.height);
  if (shownLongEdge <= input.renderedLongEdge * DETAIL_GAIN || fullLongEdge < input.renderedLongEdge * DETAIL_SOURCE_GAIN) return null;

  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  let x0 = clamp((Math.max(visible.left, box.left) - pictureLeft) / pictureW);
  let y0 = clamp((Math.max(visible.top, box.top) - pictureTop) / pictureH);
  let x1 = clamp((Math.min(visible.left + visible.width, box.left + box.width) - pictureLeft) / pictureW);
  let y1 = clamp((Math.min(visible.top + visible.height, box.top + box.height) - pictureTop) / pictureH);
  if (!(x1 > x0 && y1 > y0)) return null;
  const mx = (x1 - x0) * MARGIN, my = (y1 - y0) * MARGIN;
  x0 = clamp(x0 - mx); y0 = clamp(y0 - my); x1 = clamp(x1 + mx); y1 = clamp(y1 + my);

  const rx = Math.floor(x0 * full.width), ry = Math.floor(y0 * full.height);
  const region = { x: rx, y: ry, width: Math.min(full.width, Math.ceil(x1 * full.width)) - rx, height: Math.min(full.height, Math.ceil(y1 * full.height)) - ry };
  if (region.width < 1 || region.height < 1) return null;
  // As many pixels as the screen shows there, never more than the photo has, and within the bounds above.
  let scale = Math.min(1, (pictureW * dpr) / full.width);
  const area = region.width * region.height * scale * scale;
  if (area > DETAIL_MAX_PIXELS) scale *= Math.sqrt(DETAIL_MAX_PIXELS / area);
  const edge = Math.max(region.width, region.height) * scale;
  if (edge > DETAIL_MAX_EDGE) scale *= DETAIL_MAX_EDGE / edge;
  // Not worth it when the bounds leave it no finer than the picture already shown.
  if (fullLongEdge * scale <= input.renderedLongEdge * DETAIL_GAIN) return null;

  const view = { x: region.x / full.width, y: region.y / full.height, w: region.width / full.width, h: region.height / full.height };
  const place = {
    left: ((pictureLeft - box.left + view.x * pictureW) / box.width) * 100,
    top: ((pictureTop - box.top + view.y * pictureH) / box.height) * 100,
    width: ((view.w * pictureW) / box.width) * 100,
    height: ((view.h * pictureH) / box.height) * 100,
  };
  return { region, scale, view, place };
}
