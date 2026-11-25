import type { FrameUrls } from './frameToPhoto';

/**
 * The preview provider revokes its blob URLs when an original is developed, relinked or replaced. Every photo that
 * shares that original (virtual copies included) must forget those URLs, or a view that renders them directly, such
 * as the All formats board, shows a broken image. A recorded failure stays, so an unavailable original still says so.
 */
export function dropSourceUrls(
  urls: Record<string, FrameUrls>,
  frames: ReadonlyArray<{ id: string; stableKey: string }>,
  stableKey: string,
): { urls: Record<string, FrameUrls>; frameIds: string[] } {
  const frameIds = frames.filter((frame) => frame.stableKey === stableKey && urls[frame.id]).map((frame) => frame.id);
  if (!frameIds.length) return { urls, frameIds };
  const next = { ...urls };
  for (const id of frameIds) {
    const { failed } = next[id];
    next[id] = failed ? { failed } : {};
  }
  return { urls: next, frameIds };
}

/**
 * The provider's full-preview cache made room and revoked one original's large preview. Thumbnails are still valid,
 * so only the `preview` URL is forgotten; the photo falls back to its thumbnail until it is asked for again.
 */
export function dropSourcePreview(
  urls: Record<string, FrameUrls>,
  frames: ReadonlyArray<{ id: string; stableKey: string }>,
  stableKey: string,
): { urls: Record<string, FrameUrls>; frameIds: string[] } {
  const frameIds = frames.filter((frame) => frame.stableKey === stableKey && urls[frame.id]?.preview).map((frame) => frame.id);
  if (!frameIds.length) return { urls, frameIds };
  const next = { ...urls };
  for (const id of frameIds) {
    const { preview: _revoked, ...kept } = next[id];
    next[id] = kept;
  }
  return { urls: next, frameIds };
}
