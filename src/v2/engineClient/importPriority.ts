import { spreadPhotoOrder } from '../../core/photoProcessingOrder';
import type { ExifMetadata } from '../../core/types';
import type { PickedPhoto } from '../../providers/linkedOriginals';
import { parseImageExif } from '../../core/exifParser';
import { headBlob, openLinkedRange } from '../../providers/rangeBlob';

export interface ImportCandidate<T> { file: T; index: number }
type PriorityMetadata = Pick<ExifMetadata, 'rating' | 'rejectedByMetadata'> & { flagged?: boolean };

/** Preserve capture indices independently of the order in which bytes are processed.
 * Preflight ratings are advisory only: the full import still verifies original bytes. */
export function orderImportCandidates<T>(candidates: readonly ImportCandidate<T>[],
  metadata: ReadonlyMap<number, PriorityMetadata>): ImportCandidate<T>[] {
  const rank = (item: ImportCandidate<T>) => {
    const info = metadata.get(item.index);
    if (info?.rejectedByMetadata) return -1;
    const stars = info?.rating;
    if (typeof stars === 'number' && Number.isInteger(stars) && stars >= 1 && stars <= 5) return 10 + stars;
    return info?.flagged ? 1 : 0;
  };
  const ordered = [...candidates].sort((a,b) => a.index - b.index);
  return [
    ...ordered.filter(item => rank(item) > 0).sort((a,b) => rank(b) - rank(a)),
    ...spreadPhotoOrder(ordered.filter(item => rank(item) === 0)),
    ...spreadPhotoOrder(ordered.filter(item => rank(item) < 0)),
  ];
}

/** Only inspect the bounded EXIF head. Do not fall back to a whole native RAW
 * read merely to discover priority. Unreadable/missing metadata is ordinary,
 * not a reject. HEIF metadata outside the head may be discovered at import. */
export async function readImportPriority(file: PickedPhoto, signal: AbortSignal): Promise<PriorityMetadata> {
  signal.throwIfAborted();
  try {
    if (file.path) {
      const range = await openLinkedRange(file.path, file.size);
      try {
        const head = await headBlob(range.blob);
        signal.throwIfAborted();
        return await parseImageExif(head, file.name);
      } finally { await range.close(); }
    }
    const opened = await file.read();
    if (opened.size !== file.size || opened.lastModified !== file.lastModified) return {};
    signal.throwIfAborted();
    return await parseImageExif(await headBlob(opened), file.name);
  } catch (error) {
    signal.throwIfAborted();
    return {};
  }
}
