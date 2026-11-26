import type { PhotoFrame } from '../../core/types';

/**
 * Culling read-ahead: while one photo is on the canvas, the photos either side of it are read, unpacked and decoded in
 * the background, so the next key press shows a picture that is already in memory. Only the same preview that would be
 * shown anyway is prepared (never a smaller stand-in), and nothing is written.
 *
 * A preview for now, off by default: an admin flag (`cullWarmup`) or this device's own switch,
 * `localStorage['kestrel.preview.cullWarmup.v1'] = '1'`, turns it on.
 */
export const CULL_WARMUP_PREVIEW_KEY = 'kestrel.preview.cullWarmup.v1';

export function cullWarmupPreviewOn(storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  try { return storage?.getItem(CULL_WARMUP_PREVIEW_KEY) === '1'; } catch { return false; }
}

/**
 * The photos to prepare around the active one, nearest first: the next one (the usual direction), then the previous
 * one, then further out up to `reach` on each side. Removed photos and demo pictures are skipped.
 */
export function warmupNeighbours(frames: readonly PhotoFrame[], activeId: string | null, reach = 1): PhotoFrame[] {
  const shown = frames.filter((frame) => frame.removedAt == null);
  const at = shown.findIndex((frame) => frame.id === activeId);
  if (at < 0 || reach < 1) return [];
  const out: PhotoFrame[] = [];
  for (let step = 1; step <= reach; step += 1) {
    for (const index of [at + step, at - step]) {
      const frame = shown[index];
      if (frame && !frame.isDemo) out.push(frame);
    }
  }
  return out;
}
