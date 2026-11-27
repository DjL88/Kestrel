import { cameraFocusPoint, focusPoint, type ZoomFocus } from '../../engineClient/eyeZoom';

/**
 * The one spot the advice layer rings on the photo, in fractions of the picture as shown, and what it is, so the tag can
 * say it in words. In order: where the camera itself says it focused; a clear eye; an unsure eye (said as "check it");
 * the middle of the subject. The centre fallback of the zoom finder is a guess, not a finding, so it gets no ring.
 */
export type AdviceFocus = { kind: 'camera' | 'eye' | 'eyeMaybe' | 'subject'; x: number; y: number };

export function adviceFocus(
  area: { x: number; y: number; width: number; height: number } | undefined,
  shown: { width: number; height: number } | null,
  found: ZoomFocus | null,
): AdviceFocus | null {
  const camera = cameraFocusPoint(area, shown);
  if (camera) return { kind: 'camera', ...camera };
  if (found?.kind === 'eye') return { kind: found.sure ? 'eye' : 'eyeMaybe', x: found.x, y: found.y };
  if (found?.kind === 'subject') return { kind: 'subject', ...focusPoint(found) };
  return null;
}
