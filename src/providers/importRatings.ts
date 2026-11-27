import { parseXmpRating } from '../core/importOrder';
import { findSidecar, sidecarIndex, type SidecarSource } from './editStatusSidecar';

/**
 * Star ratings an editing app left in XMP sidecars, read before an import so rated photos can be read first. Read only,
 * small files only, a bounded number at once and a time limit: a photo whose sidecar is missing, slow or unreadable is
 * simply unrated here (its own rating is still read from the file when it is imported).
 */
export async function readSidecarRatings(
  files: ReadonlyArray<{ name: string; path?: string }>,
  picked: ReadonlyArray<{ name: string; read(): Promise<Blob> }>,
  { budgetMs = 4000, lanes = 8, signal }: { budgetMs?: number; lanes?: number; signal?: AbortSignal } = {},
): Promise<Array<number | undefined>> {
  const ratings: Array<number | undefined> = new Array(files.length).fill(undefined);
  const index: Map<string, SidecarSource> = sidecarIndex(picked.filter((file) => file.name.toLowerCase().endsWith('.xmp')) as never);
  const deadline = Date.now() + budgetMs;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(lanes, files.length) }, async () => {
    while (cursor < files.length && Date.now() < deadline && !signal?.aborted) {
      const at = cursor++;
      try {
        const blob = await findSidecar(files[at].name, files[at].path, index);
        if (blob && blob.size <= 256 * 1024) ratings[at] = parseXmpRating(await blob.text());
      } catch { /* unrated here */ }
    }
  }));
  return ratings;
}
