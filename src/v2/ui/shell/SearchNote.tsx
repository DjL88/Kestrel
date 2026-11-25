import React from 'react';
import type { Photo } from '../contract';
import { STRINGS } from '../strings';
import { searchPhotos } from '../utils/studioMath';
import { searchTerms } from '../../../core/wordSearch';

/**
 * One quiet line under the search box when the search did something the person should know about: no photo held every
 * word (so the photos holding the most words are shown, and which words), or some photos were found by what the
 * picture shows. Nothing otherwise. Read out politely by screen readers.
 */
export function SearchNote({ photos, search, pictureIds, className = '' }: {
  photos: readonly Photo[]; search: string; pictureIds?: ReadonlySet<string> | null; className?: string;
}) {
  const text = React.useMemo(() => {
    if (!searchTerms(search).length) return '';
    const result = searchPhotos(photos, search, pictureIds);
    if (result.kind === 'partial') return STRINGS.filmstrip.searchPartial(result.partialTerms.join(', '));
    if (result.byPicture > 0) return STRINGS.filmstrip.searchByPicture;
    return '';
  }, [photos, search, pictureIds]);
  return (
    <span role="status" aria-live="polite" title={text || undefined} className={`text-xs text-[var(--text-muted)] ${className}`}>
      {text}
    </span>
  );
}
