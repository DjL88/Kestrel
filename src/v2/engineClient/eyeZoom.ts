// Zoom to eye for the V2 canvas: find the subject's eye in the picture on screen (the same model-free finder V1 uses),
// and say where it is on screen. It only moves the view. It never says an eye is sharp or in focus.

export interface ScreenRect { left: number; top: number; width: number; height: number }
export type EyeZoomOutcome =
  | { kind: 'found'; confidence: 'likely' | 'possible'; clientX: number; clientY: number }
  | { kind: 'none' }
  | { kind: 'unavailable' };

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

/** Look for the eye in the frame's picture and say where it is on screen. */
export async function findEyeOnScreen(frame: Element): Promise<EyeZoomOutcome> {
  const picture = pictureIn(frame);
  if (!picture) return { kind: 'unavailable' };
  if (picture instanceof HTMLImageElement && !picture.complete) await picture.decode().catch(() => undefined);
  const { locateEye } = await import('../../providers/eyeLocator');
  let lookup;
  try {
    lookup = await locateEye(picture);
  } catch {
    return { kind: 'unavailable' };
  }
  if (!lookup.eye) return { kind: 'none' };
  const rect = picture.getBoundingClientRect();
  const fitValue = getComputedStyle(picture).objectFit;
  const fit = fitValue === 'cover' || fitValue === 'contain' ? fitValue : 'fill';
  const at = pictureToScreen(lookup.eye, naturalOf(picture), rect, fit);
  if (!at) return { kind: 'none' };
  return { kind: 'found', confidence: lookup.eye.confidence, clientX: at.x, clientY: at.y };
}
