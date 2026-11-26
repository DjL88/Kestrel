// Zoom to eye for the V2 canvas: find the subject's eye in the picture on screen (the same model-free finder V1 uses),
// and say where it is on screen. With no eye it goes to the subject, and with no subject to the centre. 100% goes first
// to where the camera says it focused. It only moves the view. It never says an eye is sharp or in focus.

import type { EyeCandidate } from '../../core/eyeFinder';
import type { SubjectGrid } from '../../core/maskTypes';

export interface ScreenRect { left: number; top: number; width: number; height: number }

/**
 * Where a point 0 to 1 across a picture lands on screen, for a picture drawn with `object-fit` cover or contain
 * inside an element of this on-screen size. Returns null when the point is outside what is shown.
 */
export function pictureToScreen(
  point: { x: number; y: number },
  natural: { width: number; height: number },
  rect: ScreenRect,
  fit: 'cover' | 'contain' | 'fill',
): { x: number; y: number } | null {
  if (!(natural.width > 0 && natural.height > 0 && rect.width > 0 && rect.height > 0)) return null;
  if (!(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)) return null;
  let drawnW = rect.width;
  let drawnH = rect.height;
  if (fit !== 'fill') {
    const scale = fit === 'cover'
      ? Math.max(rect.width / natural.width, rect.height / natural.height)
      : Math.min(rect.width / natural.width, rect.height / natural.height);
    drawnW = natural.width * scale;
    drawnH = natural.height * scale;
  }
  const x = rect.left + (rect.width - drawnW) / 2 + point.x * drawnW;
  const y = rect.top + (rect.height - drawnH) / 2 + point.y * drawnH;
  const inside = x >= rect.left - 0.5 && x <= rect.left + rect.width + 0.5 && y >= rect.top - 0.5 && y <= rect.top + rect.height + 0.5;
  return inside ? { x, y } : null;
}

type Picture = HTMLImageElement | HTMLCanvasElement;

const naturalOf = (picture: Picture) => picture instanceof HTMLImageElement
  ? { width: picture.naturalWidth, height: picture.naturalHeight }
  : { width: picture.width, height: picture.height };

/** The largest drawn picture inside a frame: the developed canvas or the preview image. */
export function pictureIn(frame: Element): Picture | null {
  let best: Picture | null = null;
  let bestArea = 0;
  frame.querySelectorAll('img, canvas').forEach((node) => {
    const picture = node as Picture;
    const natural = naturalOf(picture);
    const rect = picture.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (natural.width > 15 && natural.height > 15 && area > bestArea) { best = picture; bestArea = area; }
  });
  return best;
}

/** The subject's box, 0 to 1 across the picture, from the detector's subject grid (cells at least half sure). */
export function subjectBox(grid: SubjectGrid, threshold = 0.5): PictureBox | null {
  const { w, h, data } = grid;
  if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0)) return null;
  let decoded: string;
  try { decoded = atob(data); } catch { return null; }
  if (decoded.length !== w * h) return null;
  const cut = Math.round(threshold * 255);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (decoded.charCodeAt(y * w + x) < cut) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX / w, y: minY / h, width: (maxX - minX + 1) / w, height: (maxY - minY + 1) / h };
}

export interface PictureBox { x: number; y: number; width: number; height: number }

/**
 * Where a zoom goes. `camera` is where the camera itself says it focused (its AF area, from the file); `eye` is the
 * eye finder's spot, `sure` only when it was distinct ('likely'); `subject` is the detector's subject box.
 */
export type ZoomFocus =
  | { kind: 'camera'; x: number; y: number }
  | { kind: 'eye'; x: number; y: number; sure: boolean }
  | { kind: 'subject'; box: PictureBox }
  | { kind: 'centre' };

/**
 * Where Zoom to eye goes, in order: the eye (a 'possible' one too, said as "check it"); otherwise the subject; otherwise
 * the middle of the picture. The camera's AF area is not an eye, so it plays no part here.
 */
export function chooseZoomFocus(eye: EyeCandidate | null, subject: PictureBox | null): ZoomFocus {
  if (eye && eye.x >= 0 && eye.x <= 1 && eye.y >= 0 && eye.y <= 1) return { kind: 'eye', x: eye.x, y: eye.y, sure: eye.confidence === 'likely' };
  if (subject && subject.width > 0 && subject.height > 0) return { kind: 'subject', box: subject };
  return { kind: 'centre' };
}

/**
 * Where 100% goes, in order: where the camera focused; otherwise a clear eye; otherwise the subject's middle (an
 * unsure eye inside it is not trusted for this); otherwise the centre of the picture.
 */
export function chooseActualFocus(camera: { x: number; y: number } | null, detected: ZoomFocus | null, subject: PictureBox | null = null): ZoomFocus {
  if (camera) return { kind: 'camera', x: camera.x, y: camera.y };
  if (detected?.kind === 'eye' && detected.sure) return detected;
  if (detected?.kind === 'subject') return detected;
  if (subject && subject.width > 0 && subject.height > 0) return { kind: 'subject', box: subject };
  return { kind: 'centre' };
}

/**
 * The middle of the camera's AF area, 0 to 1 across the picture as shown, or null. The camera records it on the
 * sensor's own landscape frame, before any turn for a portrait photo, and the turn is not known here: so a picture
 * shown taller than wide is not given a point that could be on the wrong side of it.
 */
export function cameraFocusPoint(
  area: { x: number; y: number; width: number; height: number } | undefined,
  shown: { width: number; height: number } | null,
): { x: number; y: number } | null {
  if (!area || !shown || !(shown.width > 0 && shown.height > 0) || shown.height > shown.width) return null;
  const x = area.x + area.width / 2;
  const y = area.y + area.height / 2;
  if (!(Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
  return { x, y };
}

/** The point to put in the middle of the view, 0 to 1 across the picture. */
export function focusPoint(focus: ZoomFocus): { x: number; y: number } {
  if (focus.kind === 'eye' || focus.kind === 'camera') return { x: focus.x, y: focus.y };
  if (focus.kind === 'subject') return { x: focus.box.x + focus.box.width / 2, y: focus.box.y + focus.box.height / 2 };
  return { x: 0.5, y: 0.5 };
}

/**
 * The view zoom for a focus. An eye or the centre goes to 100% (`actual`, one picture pixel per screen pixel); the
 * subject is zoomed until it fills about two thirds of the view, never past 100% and never below Fit.
 */
export function focusZoom(
  focus: ZoomFocus,
  opts: { current: number; actual: number; pictureOnScreen: { width: number; height: number }; view: { width: number; height: number } },
): number {
  const actual = Math.min(16, Math.max(1, opts.actual));
  if (focus.kind !== 'subject') return actual;
  const perZoomW = (focus.box.width * opts.pictureOnScreen.width) / Math.max(0.01, opts.current);
  const perZoomH = (focus.box.height * opts.pictureOnScreen.height) / Math.max(0.01, opts.current);
  if (!(perZoomW > 0 && perZoomH > 0)) return actual;
  const fill = Math.min((opts.view.width * 0.66) / perZoomW, (opts.view.height * 0.66) / perZoomH);
  return Math.min(actual, Math.max(1, fill));
}

/** A box grown by a share of its own size on every side, kept inside the picture. */
export function padBox(box: PictureBox, share: number): PictureBox {
  const x0 = Math.max(0, box.x - box.width * share);
  const y0 = Math.max(0, box.y - box.height * share);
  const x1 = Math.min(1, box.x + box.width * (1 + share));
  const y1 = Math.min(1, box.y + box.height * (1 + share));
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

/** Subject weights (0 to 1) for a crop of the picture, `width` × `height` pixels, read from the whole-picture grid. */
export function cropWeights(grid: SubjectGrid, region: PictureBox, width: number, height: number): Float32Array | null {
  const { w, h, data } = grid;
  if (!(Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && width > 0 && height > 0)) return null;
  let decoded: string;
  try { decoded = atob(data); } catch { return null; }
  if (decoded.length !== w * h) return null;
  const weights = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const gy = Math.min(h - 1, Math.max(0, Math.floor((region.y + ((y + 0.5) / height) * region.height) * h)));
    for (let x = 0; x < width; x += 1) {
      const gx = Math.min(w - 1, Math.max(0, Math.floor((region.x + ((x + 0.5) / width) * region.width) * w)));
      weights[y * width + x] = decoded.charCodeAt(gy * w + gx) / 255;
    }
  }
  return weights;
}

export type FocusLookup = { kind: 'ready'; focus: ZoomFocus; subject: PictureBox | null } | { kind: 'unavailable' };

/**
 * Where Zoom to eye should go for this photo's preview. The search runs off the canvas (from the preview itself) and
 * is kept, so asking again, or asking after the background search has run, is instant.
 */
export async function lookForZoomFocus(photoId: string, previewUrl: string): Promise<FocusLookup> {
  if (!previewUrl) return { kind: 'unavailable' };
  const { zoomTargetsFor } = await import('../../providers/zoomTargets');
  const targets = await zoomTargetsFor(photoId, previewUrl);
  // The finder could not run on this device: the centre is still a useful place to look.
  if (!targets) return { kind: 'ready', focus: { kind: 'centre' }, subject: null };
  return { kind: 'ready', focus: chooseZoomFocus(targets.eye, targets.subject), subject: targets.subject };
}

/** Start the background search for photos that may be shown next, without waiting for it. */
export function warmZoomTargets(photos: readonly { id: string; previewUrl: string }[]): void {
  if (!photos.length) return;
  void import('../../providers/zoomTargets').then(({ zoomTargetsFor }) => {
    for (const photo of photos) if (photo.previewUrl) void zoomTargetsFor(photo.id, photo.previewUrl);
  }).catch(() => undefined);
}

/** Where a focus lands on screen now, plus the picture's on-screen size. Null when the picture is not shown. */
export function focusOnScreen(frame: Element, focus: ZoomFocus): { clientX: number; clientY: number; picture: ScreenRect } | null {
  const picture = pictureIn(frame);
  if (!picture) return null;
  const rect = picture.getBoundingClientRect();
  const fitValue = getComputedStyle(picture).objectFit;
  const fit = fitValue === 'cover' || fitValue === 'contain' ? fitValue : 'fill';
  const at = pictureToScreen(focusPoint(focus), naturalOf(picture), rect, fit);
  if (!at) return null;
  return { clientX: at.x, clientY: at.y, picture: rect };
}
