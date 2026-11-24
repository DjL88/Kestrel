import type { PhotoFrame } from '../../core/types';
import { DEVELOP_VERSION } from '../../core/backgroundDevelop';
import { loadOfflinePreview, loadOfflinePreviewPair, previewCacheKey, type OfflinePreviewPair } from '../../providers/offlinePreviewCache';

/** How many photos the Projects page may look at per project, so a large shoot never stalls it. */
const LOOKUP_BUDGET = 12;

/**
 * The project's favourites, best first: kept photos by star rating, then other photos (set aside last) by star rating.
 * Some of the bounded lookup budget is kept for non-keepers in case every keeper's cached picture has been evicted.
 * Removed photos are never chosen.
 */
export function coverCandidates(frames: readonly PhotoFrame[]): PhotoFrame[] {
  const live = frames.filter((frame) => frame.removedAt == null);
  const rating = (frame: PhotoFrame) => Number.isInteger(frame.rating) && frame.rating! >= 1 && frame.rating! <= 5 ? frame.rating! : 0;
  const keepers = live.filter(frame => frame.decision === 'keep').sort((a, b) => rating(b) - rating(a));
  const others = live.filter(frame => frame.decision !== 'keep').sort((a, b) =>
    Number(a.decision === 'reject') - Number(b.decision === 'reject') || rating(b) - rating(a));
  const keeperBudget = Math.min(keepers.length, LOOKUP_BUDGET - Math.min(4, others.length));
  return [...keepers.slice(0, keeperBudget), ...others.slice(0, LOOKUP_BUDGET - keeperBudget)];
}

/** The key the offline preview cache uses for this original (the same one BrowserPreviewProvider uses without the file). */
export function hubPreviewKey(frame: PhotoFrame): string {
  const parts = frame.stableKey.split('::');
  const size = Number(parts.at(-2));
  const modified = Number(parts.at(-1));
  return previewCacheKey({
    stableKey: frame.stableKey,
    filename: frame.filename,
    fileSize: Number.isFinite(size) && size > 0 ? size : undefined,
    lastModified: Number.isFinite(modified) && modified >= 0 ? modified : undefined,
  });
}

function usable(blob: Blob | undefined | null): blob is Blob {
  return Boolean(blob && blob.type.startsWith('image/') && blob.size > 0);
}

/** Read only a locally cached, derived thumbnail. Never read or upload an original from the project hub. */
export async function projectCoverBlob(
  frames: readonly PhotoFrame[],
  loadPreview: (key: string) => Promise<Blob | null> = loadOfflinePreview,
): Promise<Blob | null> {
  for (const frame of coverCandidates(frames)) {
    try {
      const blob = await loadPreview(hubPreviewKey(frame));
      if (usable(blob)) return blob;
    } catch {
      // A corrupt or unavailable cache record should not prevent opening the hub.
    }
  }
  return null;
}

export interface ProjectPreviews {
  /** The best favourite at review size (up to 2200 px wide), or null when nothing is cached on this device. */
  cover: Blob | null;
  /** Up to `samples` further favourites, thumbnail size, for the list view. */
  samples: Blob[];
}

/**
 * Pictures for the Projects page. Reads only derived pictures already stored on this device: the picture InFlight developed
 * in the background from the RAW sensor data when there is one, otherwise the camera's embedded preview. The cover is the
 * review-size picture, not the 400 px thumbnail, so it stays sharp at any tile size. Never reads, decodes or uploads an
 * original. The photographer's own edits are not applied: no edited render is stored on the device yet.
 */
export async function projectPreviewBlobs(
  frames: readonly PhotoFrame[],
  samples = 3,
  loadPair: (key: string) => Promise<OfflinePreviewPair | null> = loadOfflinePreviewPair,
): Promise<ProjectPreviews> {
  const found: OfflinePreviewPair[] = [];
  for (const frame of coverCandidates(frames)) {
    if (found.length > samples) break;
    const key = hubPreviewKey(frame);
    const developed = await loadPair(`developed-v${DEVELOP_VERSION}:${key}`).catch(() => null);
    const pair = developed && usable(developed.review) ? developed : await loadPair(key).catch(() => null);
    if (pair && (usable(pair.review) || usable(pair.thumbnail))) found.push(pair);
  }
  const [first, ...rest] = found;
  return {
    cover: first ? (usable(first.review) ? first.review : first.thumbnail) : null,
    samples: rest.slice(0, samples).map((pair) => (usable(pair.thumbnail) ? pair.thumbnail : pair.review)),
  };
}
