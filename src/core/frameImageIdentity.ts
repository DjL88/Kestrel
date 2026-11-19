/** A render belongs to one specific catalogue photo and viewer resolution.
 * A mounted thumbnail/Compare tile can be recycled for another frame while
 * its async preview load is in flight. Never show the old frame under the
 * new frame's filename, cull decision or species label.
 */
export function frameImageIdentity(
  frame: { id: string; stableKey: string },
  variant: 'thumb' | 'full',
): string {
  return JSON.stringify([frame.id, frame.stableKey, variant]);
}

/** Editing the same frame may retain the last successfully rendered preview;
 * switching to another frame must hide it immediately, before effects run.
 */
export function visibleFrameUrl(
  rendered: { identity: string; url: string },
  currentIdentity: string,
): string {
  return rendered.identity === currentIdentity ? rendered.url : '';
}

/** Editing a selected full-size photo must not add another lossy JPEG pass.
 * This is only the screen preview (bounded to 2200px), not an archival export.
 */
export function framePreviewEncoding(variant: 'thumb' | 'full'): { mime: string; quality?: number } {
  return variant === 'full' ? { mime: 'image/png' } : { mime: 'image/jpeg', quality: 0.92 };
}
