import type { PhotoFrame } from '../../core/types';
import { loadOfflinePreview, previewCacheKey } from '../../providers/offlinePreviewCache';

/** Read only a locally cached, derived thumbnail. Never read or upload an original from the project hub. */
export async function projectCoverBlob(frames: readonly PhotoFrame[]): Promise<Blob | null> {
  const live = frames.filter((frame) => frame.removedAt == null);
  const candidates = [...live.filter((frame) => frame.decision === 'keep'), ...live.filter((frame) => frame.decision !== 'keep')];
  for (const frame of candidates.slice(0, 12)) {
    const parts = frame.stableKey.split('::');
    const size = Number(parts.at(-2));
    const modified = Number(parts.at(-1));
    const key = previewCacheKey({
      stableKey: frame.stableKey,
      filename: frame.filename,
      fileSize: Number.isFinite(size) && size > 0 ? size : undefined,
      lastModified: Number.isFinite(modified) && modified >= 0 ? modified : undefined,
    });
    const blob = await loadOfflinePreview(key);
    if (blob && blob.type.startsWith('image/') && blob.size > 0) return blob;
  }
  return null;
}
