// Zoom to eye for the V2 canvas: find the subject's eye in the picture on screen (the same model-free finder V1 uses),
// and say where it is on screen. With no confident eye it goes to the subject, and with no subject to the centre. It only moves the view. It never says an eye is sharp or in focus.

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
 * Where Zoom to eye goes, in order: a confident eye; otherwise the subject; otherwise the middle of the picture.
 * A 'possible' eye is not confident enough to zoom to on its own, so it falls back to the subject.
 */
export type ZoomFocus =
  | { kind: 'eye'; x: number; y: number }
  | { kind: 'subject'; box: PictureBox }
  | { kind: 'centre' };

export function chooseZoomFocus(eye: EyeCandidate | null, subject: PictureBox | null): ZoomFocus {
  if (eye && eye.confidence === 'likely') return { kind: 'eye', x: eye.x, y: eye.y };
  if (subject && subject.width > 0 && subject.height > 0) return { kind: 'subject', box: subject };
  return { kind: 'centre' };
}

/** The point to put in the middle of the view, 0 to 1 across the picture. */
export function focusPoint(focus: ZoomFocus): { x: number; y: number } {
  if (focus.kind === 'eye') return { x: focus.x, y: focus.y };
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

export type FocusLookup = { kind: 'ready'; focus: ZoomFocus } | { kind: 'unavailable' };

/** Look once in the frame's picture for where Zoom to eye should go. Run ahead of time, so the menu can say. */
export async function lookForZoomFocus(frame: Element): Promise<FocusLookup> {
  const picture = pictureIn(frame);
  if (!picture) return { kind: 'unavailable' };
  if (picture instanceof HTMLImageElement && !picture.complete) await picture.decode().catch(() => undefined);
  const natural = naturalOf(picture);
  if (!(natural.width > 15 && natural.height > 15)) return { kind: 'unavailable' };
  const { locateEye } = await import('../../providers/eyeLocator');
  try {
    const lookup = await locateEye(picture);
    const box = lookup.subject?.assessment.usable ? subjectBox(lookup.subject.grid) : null;
    return { kind: 'ready', focus: chooseZoomFocus(lookup.eye, box) };
  } catch {
    // The finder could not run on this device: the centre is still a useful place to look.
    return { kind: 'ready', focus: { kind: 'centre' } };
  }
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
