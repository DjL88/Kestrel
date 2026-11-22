import React from 'react';
import type { Photo } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import { filterPhotos } from '../utils/studioMath';

interface GridViewProps {
  photos: Photo[];
  activePhotoId: string | null;
  selectedPhotoIds: string[];
  filter: 'all' | 'flagged' | 'set-aside';
  search: string;
  onSelectPhoto: (photoId: string, modifiers?: { ctrl?: boolean; shift?: boolean }) => void;
  onOpenInEditor: (photoId: string) => void;
  onToggleFlag: (photoIds: string[]) => void;
  onSetRating: (photoIds: string[], rating: number) => void;
  onSetFilter: (filter: 'all' | 'flagged' | 'set-aside') => void;
  onSetSearch: (q: string) => void;
  onClose: () => void;
}

export default function GridView({
  photos,
  activePhotoId,
  selectedPhotoIds,
  filter,
  search,
  onSelectPhoto,
  onOpenInEditor,
  onToggleFlag,
  onSetRating,
  onSetFilter,
  onSetSearch,
  onClose,
}: GridViewProps) {
  const visible = filterPhotos(photos, filter, search);
  const flaggedCount = photos.filter((p) => p.decision === 'keep').length;
  const setAsideCount = photos.filter((p) => p.decision === 'reject').length;

  return (
    <section
      aria-label="All photos grid view"
      className="flex flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]"
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {STRINGS.canvas.gridViewToggle}
          </h2>
          <span className="text-xs text-[var(--text-muted)] tabular-nums">
            {visible.length} of {photos.length} · {flaggedCount} flagged
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-0.5">
            <button
              type="button"
              onClick={() => onSetFilter('all')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {STRINGS.filmstrip.filterAll}
            </button>
            <button
              type="button"
              onClick={() => onSetFilter('flagged')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                filter === 'flagged'
                  ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {STRINGS.filmstrip.filterFlagged} ({flaggedCount})
            </button>
          </div>

          <button type="button" onClick={() => onSetFilter('set-aside')}
            aria-pressed={filter === 'set-aside'}
            className={`h-8 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 text-xs font-medium ${filter === 'set-aside' ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
            Set aside ({setAsideCount})
          </button>
          <div className="relative">
            <BrandIcon
              name="search"
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => onSetSearch(e.target.value)}
              placeholder={STRINGS.filmstrip.searchPlaceholder}
              aria-label={STRINGS.filmstrip.searchPlaceholder}
              className="h-8 w-48 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] pl-8 pr-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </div>

          {selectedPhotoIds.length > 1 && (
            <button
              type="button"
              onClick={() => onToggleFlag(selectedPhotoIds)}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
            >
              <BrandIcon name="flag" size={13} />
              <span>Flag {selectedPhotoIds.length}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--bg-surface-active)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
          >
            <BrandIcon name="close" size={13} />
            <span>Back to canvas</span>
          </button>
        </div>
      </div>

      {/* Contact sheet grid */}
      <div className="flex-1 overflow-y-auto inflight-scroll p-4 md:p-6">
        {visible.length === 0 ? (
          <div className="flex h-60 items-center justify-center text-sm text-[var(--text-muted)]">
            {STRINGS.filmstrip.nothingMatches}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visible.map((photo) => {
              const selected = selectedPhotoIds.includes(photo.id);
              const active = activePhotoId === photo.id;
              const flagged = photo.decision === 'keep';
              const stateWord = STRINGS.filmstrip.tileStates[photo.state];

              return (
                <article
                  key={photo.id}
                  className={`group flex flex-col overflow-hidden rounded-[var(--radius-md)] border transition-colors ${
                    selected
                      ? 'border-[var(--brand-accent)] bg-[var(--bg-surface-raised)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) =>
                      onSelectPhoto(photo.id, {
                        ctrl: e.ctrlKey || e.metaKey,
                        shift: e.shiftKey,
                      })
                    }
                    onDoubleClick={() => onOpenInEditor(photo.id)}
                    className="relative aspect-[3/2] w-full overflow-hidden bg-[var(--bg-canvas)] text-left"
                  >
                    <img
                      src={photo.thumbUrl}
                      alt={photo.title}
                      referrerPolicy="no-referrer"
                      className={`h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03] ${
                        photo.state === 'unavailable' ? 'opacity-65' : ''
                      }`}
                    />
                    {active && (
                      <span className="absolute left-2 top-2 rounded bg-[var(--bg-scrim)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                        Active
                      </span>
                    )}
                    <span className="absolute bottom-2 left-2 rounded bg-[var(--bg-scrim)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {stateWord}
                    </span>
                  </button>

                  <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-[var(--text-primary)]">
                        {photo.filename}
                      </p>
                      <div className="mt-1 flex items-center gap-0.5" aria-label={`Rating ${photo.rating} of 5`}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            aria-label={`Rate ${photo.filename} ${n} stars`}
                            onClick={() => onSetRating([photo.id], n)}
                            className="p-0.5 text-[var(--brand-accent)] hover:scale-110 transition-transform"
                          >
                            <BrandIcon
                              name={n <= photo.rating ? 'star-filled' : 'star-empty'}
                              size={11}
                              className={n <= photo.rating ? 'text-[var(--brand-accent)]' : 'text-[var(--text-muted)]'}
                            />
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      aria-label={flagged ? `Unflag ${photo.filename}` : `Flag ${photo.filename}`}
                      onClick={() => onToggleFlag([photo.id])}
                      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors ${
                        flagged
                          ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                          : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <BrandIcon name={flagged ? 'flag' : 'flag-off'} size={15} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
