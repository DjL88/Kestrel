import type { VideoZoomConfig } from '../ui/contract';

export const DEFAULT_VIDEO_ZOOM: VideoZoomConfig = { enabled: false, focalX: 50, focalY: 50, direction: 'in', durationSec: 6 };
const MAX_DURATION_SEC = 60;

const num = (value: unknown, fallback: number, min: number, max: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);

/**
 * This photo's video pan/zoom (Ken Burns) settings, made valid: a focal point that stays on the frame, a direction that is
 * one of the two Kestrel supports, and a duration within a sane range. Read defensively, because a stored value can come
 * from an older build or a damaged file; anything unreadable falls back to "off" rather than surprising the person with an
 * animation they didn't choose.
 */
export function readVideoZoom(raw: unknown): VideoZoomConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_VIDEO_ZOOM };
  const value = raw as Record<string, unknown>;
  return {
    enabled: value.enabled === true,
    focalX: num(value.focalX, DEFAULT_VIDEO_ZOOM.focalX, 0, 100),
    focalY: num(value.focalY, DEFAULT_VIDEO_ZOOM.focalY, 0, 100),
    direction: value.direction === 'out' ? 'out' : 'in',
    durationSec: num(value.durationSec, DEFAULT_VIDEO_ZOOM.durationSec, 1, MAX_DURATION_SEC),
  };
}

/** Applies a partial change on top of the photo's current (sanitised) video zoom settings. */
export function patchVideoZoom(raw: unknown, patch: Partial<VideoZoomConfig>): VideoZoomConfig {
  return readVideoZoom({ ...readVideoZoom(raw), ...patch });
}
