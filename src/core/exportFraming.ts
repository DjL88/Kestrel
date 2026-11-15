import { exportScale, type ExportProfile } from './exportProfiles';
import { cropRectangle } from './photoFraming';

export interface FocusPoint { x: number; y: number }
export type ExportFraming = 'fit' | 'focus' | 'border' | 'long';

export function planExportFraming(width: number, height: number, profile: ExportProfile, mode: ExportFraming,
  focus: FocusPoint = { x: 0.5, y: 0.5 }, longEdge?: number, zoom = 1) {
  const hasBox = profile.width > 0 && profile.height > 0;
  const region = mode === 'focus' && hasBox
    ? cropRectangle(width, height, { ratio: profile.width / profile.height, x: focus.x, y: focus.y, turns: 0, straighten: 0, size: 1 / clampZoom(zoom) })
    : { x: 0, y: 0, width, height };
  const scale = mode === 'long'
    ? Math.min(1, (longEdge || Math.max(profile.width, profile.height) || Math.max(width, height)) / Math.max(width, height))
    : exportScale(region.width, region.height, profile);
  const border = mode === 'border' && hasBox ? { width: profile.width, height: profile.height } : undefined;
  return { region, scale, border };
}

export const MAX_ZOOM = 4;

/** Zoom is how far in the crop looks: 1 shows as much of the photo as the shape allows, 4 shows a quarter of that. */
export function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? Math.min(MAX_ZOOM, Math.max(1, zoom)) : 1;
}

/**
 * Keep a crop position where it can actually take effect. The crop's centre cannot go closer to an edge than half the
 * crop, so positions beyond that do nothing. Clamping to the real range stops a drag from going "dead" at the edges.
 * `photo` and `crop` are the same kind of length (pixels across, or down).
 */
export function clampAnchor(value: number, photo: number, crop: number): number {
  if (!(photo > 0) || crop >= photo) return 0.5;
  const half = crop / photo / 2;
  return Math.min(1 - half, Math.max(half, value));
}
