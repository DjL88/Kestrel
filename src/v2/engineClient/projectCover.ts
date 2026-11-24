import type { PhotoFrame } from '../../core/types';
import { loadOfflinePreview, previewCacheKey } from '../../providers/offlinePreviewCache';

/** Read only a locally cached, derived thumbnail. Never read or upload an original from the project hub. */
export async function projectCoverBlob(
  frames: readonly PhotoFrame[],
  loadPreview: (key: string) => Promise<Blob | null> = loadOfflinePreview,
): Promise<Blob | null> {
  const live = frames.filter((frame) => frame.removedAt == null);
  const keepers = live.filter(frame => frame.decision === 'keep');
  const others = live.filter(frame => frame.decision !== 'keep');
  // Reserve some of the bounded lookup budget for other photos in case all
  // saved keepers are offline or their derived thumbnails have been evicted.
  const keeperBudget = Math.min(keepers.length, 12 - Math.min(4, others.length));
  const candidates = [...keepers.slice(0, keeperBudget), ...others.slice(0, 12 - keeperBudget)];
  for (const frame of candidates) {
    const parts = frame.stableKey.split('::');
    const size = Number(parts.at(-2));
    const modified = Number(parts.at(-1));
    const key = previewCacheKey({
      stableKey: frame.stableKey,
      filename: frame.filename,
      fileSize: Number.isFinite(size) && size > 0 ? size : undefined,
      lastModified: Number.isFinite(modified) && modified >= 0 ? modified : undefined,
    });
    try {
      const blob = await loadPreview(key);
      if (blob && blob.type.startsWith('image/') && blob.size > 0) return blob;
    } catch {
      // A corrupt or unavailable cache record should not prevent opening the hub.
    }
  }
  return null;
}
