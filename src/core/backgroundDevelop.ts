import { prioritizePhotoProcessing } from './photoProcessingOrder';
import { isRawPreviewFile } from './rawFormats';
import type { PhotoFrame } from './types';

/**
 * Developing every RAW in the background, so the library, culling and the editor show Kite44's own develop rather than
 * the camera's embedded JPEG. Pure scheduling; the work itself is in src/providers.
 */

/** Raise when the develop changes, so pictures stored by an older one are made again. */
export const DEVELOP_VERSION = 1;

/**
 * The RAW photos still to develop, in the order to do them: the one on screen first, then starred and kept photos, then
 * the rest sampled across the shoot (as the cull scan does), camera rejects last. Each original once, removed photos never.
 */
export function developQueue(
  frames: readonly PhotoFrame[], isDone: (frame: PhotoFrame) => boolean, onScreen?: string | null,
): PhotoFrame[] {
  const seen = new Set<string>();
  const wanted = frames.filter((frame) => {
    if (frame.removedAt != null || !isRawPreviewFile(frame.filename) || seen.has(frame.stableKey) || isDone(frame)) return false;
    seen.add(frame.stableKey);
    return true;
  });
  const ordered = prioritizePhotoProcessing(wanted);
  const first = onScreen ? ordered.findIndex((frame) => frame.id === onScreen || frame.stableKey === onScreen) : -1;
  return first > 0 ? [ordered[first], ...ordered.slice(0, first), ...ordered.slice(first + 1)] : ordered;
}

