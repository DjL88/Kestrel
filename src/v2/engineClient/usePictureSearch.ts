import { useEffect, useState } from 'react';
import type { PhotoFrame } from '../../core/types';

/**
 * The photos whose picture matches what is typed in the search box, worked out on this device (`pictureSearch.ts`).
 * Null while search by description is not on this device, or for a query too short to describe anything: then the
 * search box finds photos by their words only. Never throws: a failure means words only.
 */
export function usePictureSearch(search: string, frames: readonly PhotoFrame[]): string[] | null {
  const [found, setFound] = useState<{ query: string; ids: string[] } | null>(null);
  const query = search.trim();
  useEffect(() => {
    if (query.length < 3) return undefined;
    let cancelled = false;
    // Wait for typing to pause, so the text model runs once per description rather than once per letter.
    const timer = window.setTimeout(() => {
      void import('../../providers/pictureSearch')
        .then(({ photosMatchingDescription }) => photosMatchingDescription(query, frames))
        .then((ids) => { if (!cancelled) setFound(ids ? { query, ids } : null); })
        .catch((error) => { console.warn('Search by description is unavailable', error); if (!cancelled) setFound(null); });
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, frames]);
  return found && found.query === query ? found.ids : null;
}
