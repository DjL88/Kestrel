import React, { useEffect, useRef, useState } from 'react';
import type { FilmstripFilter, Photo, PhotoSort } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import FinishBestButton, { type FinishBestEntry } from './FinishBestButton';
import { SearchNote } from './SearchNote';
import { viewPhotos } from '../utils/studioMath';

const FILTERS: FilmstripFilter[] = ['all', 'to-review', 'flagged', 'set-aside'];
const SORTS: PhotoSort[] = ['shoot', 'captured-oldest', 'captured-newest', 'filename', 'rating', 'best'];

/**
 * The first of the phone's two pages: every photo in the project as one grid. A tap opens the photo for editing (the second
 * page). Import, filter, sort, search, Auto pick and the rest sit behind one ⋯ menu in the header, where the long filmstrip
 * row used to be, so each thing is one tap away and nothing is squeezed. The filmstrip itself is not drawn on a phone.
 */
export default function PhoneGridPage({
  projectName, photos, activePhotoId, filter, search, sort, minRating, pictureIds = null,
  onBack, onOpenPhoto, onToggleFlag, onSetFilter, onSetSearch, onSetSort, onSetMinRating,
  onImport, onRunAutoCull, finishBest, onOpenRemoved, onExport,
}: {
  projectName: string;
  photos: Photo[];
  activePhotoId: string | null;
  filter: FilmstripFilter;
  search: string;
  sort: PhotoSort;
  minRating: number;
  pictureIds?: ReadonlySet<string> | null;
  onBack: () => void;
  onOpenPhoto: (photoId: string) => void;
  onToggleFlag: (photoIds: string[]) => void;
  onSetFilter: (filter: FilmstripFilter) => void;
  onSetSearch: (q: string) => void;
  onSetSort: (sort: PhotoSort) => void;
  onSetMinRating: (rating: number) => void;
  onImport: () => void;
  onRunAutoCull?: () => void;
  finishBest?: FinishBestEntry;
  onOpenRemoved: () => void;
  onExport: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searching, setSearching] = useState(Boolean(search));
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const visible = viewPhotos(photos, { filter, search, minRating, sort, tag: null, pictureIds });
  const flagged = photos.filter((photo) => photo.decision === 'keep').length;
  const counts: Record<FilmstripFilter, number> = {
    all: photos.length,
    'to-review': photos.filter((photo) => photo.decision === 'unreviewed').length,
    flagged,
    'set-aside': photos.filter((photo) => photo.decision === 'reject').length,
  };
  const filterLabel: Record<FilmstripFilter, string> = {
    all: STRINGS.filmstrip.filterAll, 'to-review': STRINGS.filmstrip.filterToReview,
    flagged: STRINGS.filmstrip.filterFlagged, 'set-aside': STRINGS.filmstrip.filterSetAside,
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menuOpen]);

  const item = 'flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]';
  const run = (action: () => void) => () => { setMenuOpen(false); action(); };

  return (
    <section aria-label={STRINGS.photoGrid.allPhotosGridView} data-testid="phone-grid-page" className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1">
        <button type="button" onClick={onBack} aria-label={STRINGS.topBar.backToProjects} title={STRINGS.topBar.backToProjects}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
          <BrandIcon name="arrow-left" size={18} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col leading-tight" data-testid="phone-grid-title">
          <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{projectName}</span>
          <span className="truncate text-xs tabular-nums text-[var(--text-secondary)]">
            {visible.length === photos.length ? `${photos.length}` : `${visible.length} of ${photos.length}`} · {flagged} {STRINGS.filmstrip.filterFlagged.toLowerCase()}
          </span>
        </div>
        <button type="button" aria-label={STRINGS.filmstrip.searchToggle} aria-pressed={searching} data-testid="phone-grid-search-toggle"
          onClick={() => setSearching((on) => !on)}
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] hover:bg-[var(--bg-surface-hover)] ${searching ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
          <BrandIcon name="search" size={18} />
        </button>
        <div className="relative shrink-0">
          <button ref={menuButton} type="button" data-testid="phone-grid-menu-button" aria-haspopup="menu" aria-expanded={menuOpen}
            aria-label={STRINGS.filmstrip.rowMoreLabel} onClick={() => setMenuOpen((open) => !open)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" aria-hidden="true" onPointerDown={() => setMenuOpen(false)} />
              <div ref={menuRef} role="menu" aria-label={STRINGS.filmstrip.rowMoreLabel} data-testid="phone-grid-menu"
                className="absolute right-0 top-full z-50 mt-1 max-h-[calc(100dvh-8rem)] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-2 shadow-[var(--shadow-popover)]">
                <button type="button" role="menuitem" className={item} onClick={run(onImport)} data-testid="phone-grid-import">
                  <BrandIcon name="image-plus" size={18} />{STRINGS.topBar.fileActions.importPhotos}
                </button>
                {onRunAutoCull && (
                  <button type="button" role="menuitem" className={item} onClick={run(onRunAutoCull)}>
                    <BrandIcon name="assist" size={18} />{STRINGS.filmstrip.autoCull}
                  </button>
                )}
                {finishBest && <div className="px-3 py-1"><FinishBestButton entry={finishBest} compact /></div>}
                <div role="group" aria-label={STRINGS.filmstrip.filterByDecision} className="mt-1 border-t border-[var(--border-subtle)] pt-1">
                  {FILTERS.map((id) => (
                    <button key={id} type="button" role="menuitemradio" aria-checked={filter === id} className={item}
                      data-testid={`phone-grid-filter-${id}`} onClick={() => onSetFilter(id)}>
                      <span className="inline-flex w-[18px] justify-center text-[var(--brand-accent)]" aria-hidden="true">{filter === id ? <BrandIcon name="check" size={15} /> : null}</span>
                      <span className="flex-1">{filterLabel[id]}</span>
                      <span className="text-xs tabular-nums text-[var(--text-muted)]">{counts[id]}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-1 space-y-2 border-t border-[var(--border-subtle)] px-3 pb-2 pt-2">
                  <label className="block space-y-1 text-xs text-[var(--text-secondary)]">
                    <span>{STRINGS.filmstrip.sortLabel}</span>
                    <select value={sort} onChange={(event) => onSetSort(event.target.value as PhotoSort)} data-testid="phone-grid-sort"
                      className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-sm text-[var(--text-primary)]">
                      {SORTS.map((id) => <option key={id} value={id}>{STRINGS.filmstrip.sortNames[id]}</option>)}
                    </select>
                  </label>
                  <label className="block space-y-1 text-xs text-[var(--text-secondary)]">
                    <span>{STRINGS.filmstrip.ratingLabel}</span>
                    <select value={minRating} onChange={(event) => onSetMinRating(Number(event.target.value))}
                      className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-sm text-[var(--text-primary)]">
                      <option value={0}>{STRINGS.filmstrip.anyRating}</option>
                      {[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{STRINGS.filmstrip.ratingAtLeast(rating)}</option>)}
                    </select>
                  </label>
                </div>
                <div className="mt-1 border-t border-[var(--border-subtle)] pt-1">
                  <button type="button" role="menuitem" className={item} onClick={run(onExport)}>
                    <BrandIcon name="save" size={18} />{STRINGS.topBar.fileActions.exportSelected}
                  </button>
                  <button type="button" role="menuitem" className={item} onClick={run(onOpenRemoved)}>
                    <BrandIcon name="trash" size={18} />{STRINGS.topBar.fileActions.removedPhotos}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {searching && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
          <input type="search" autoFocus value={search} onChange={(event) => onSetSearch(event.target.value)} data-testid="phone-grid-search"
            placeholder={STRINGS.filmstrip.searchPlaceholder} aria-label={STRINGS.filmstrip.searchPlaceholder}
            className="h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" />
        </div>
      )}
      <SearchNote photos={photos} search={search} pictureIds={pictureIds} className="shrink-0 truncate px-3 pt-1 text-xs" />

      <div className="min-h-0 flex-1 overflow-y-auto inflight-scroll p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]" data-testid="phone-grid">
        {photos.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <BrandIcon name="folder-open" size={28} className="text-[var(--text-muted)]" />
            <button type="button" onClick={onImport} data-testid="phone-grid-empty-import"
              className="inline-flex h-12 items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--brand-accent)] px-6 text-sm font-semibold text-[var(--text-on-accent)]">
              <BrandIcon name="image-plus" size={17} />{STRINGS.filmstrip.importPhotos}
            </button>
          </div>
        ) : visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-[var(--text-muted)]">{STRINGS.filmstrip.nothingMatches}</p>
        ) : (
          <ul role="listbox" aria-label={STRINGS.photoGrid.allPhotosGridView} className="grid grid-cols-3 gap-1">
            {visible.map((photo) => {
              const isFlagged = photo.decision === 'keep';
              const stateWord = STRINGS.filmstrip.tileStates[photo.state];
              return (
                <li key={photo.id} role="option" aria-selected={photo.id === activePhotoId} data-thumb-id={photo.id} data-testid="phone-grid-tile"
                  className={`relative aspect-square overflow-hidden rounded-[var(--radius-sm)] bg-[var(--bg-surface)] ${photo.id === activePhotoId ? 'ring-2 ring-[var(--brand-accent)]' : ''}`}>
                  <button type="button" onClick={() => onOpenPhoto(photo.id)} aria-label={`${photo.title}, ${stateWord}`}
                    className="v2-no-callout block h-full w-full text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--brand-accent)]">
                    <img src={photo.thumbUrl} alt="" referrerPolicy="no-referrer" draggable={false}
                      className={`h-full w-full object-cover ${photo.state === 'unavailable' ? 'opacity-65' : ''}`} />
                    {photo.state !== 'ready' && (
                      <span className="absolute inset-x-0 bottom-0 truncate bg-[var(--bg-scrim)] px-1 py-0.5 text-[0.625rem] font-medium text-white">{stateWord}</span>
                    )}
                    {photo.rating > 0 && (
                      <span className="absolute bottom-1 right-1 inline-flex items-center gap-0.5 rounded bg-[var(--bg-scrim)] px-1 text-[0.625rem] font-semibold tabular-nums text-white" aria-label={`Rating ${photo.rating} of 5`}>
                        <BrandIcon name="star-filled" size={9} />{photo.rating}
                      </span>
                    )}
                  </button>
                  <button type="button" onClick={() => onToggleFlag([photo.id])} aria-pressed={isFlagged}
                    aria-label={`${isFlagged ? STRINGS.filmstrip.unflagAction : STRINGS.filmstrip.flagAction} ${photo.filename}`}
                    className={`v2-hit absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full ${isFlagged ? 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]' : 'text-white/85 [filter:drop-shadow(0_1px_2px_rgb(0_0_0/0.8))]'}`}>
                    <BrandIcon name={isFlagged ? 'flag' : 'flag-off'} size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
