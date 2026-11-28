import React, { useState } from 'react';
import { engineText } from '../../../i18n/areas/engine';
import type { DecisionState, FilmstripFilter, Photo, PhotoSort } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import FinishBestButton from './FinishBestButton';
import PictureSourceBadge from './PictureSourceBadge';
import { viewPhotos } from '../utils/studioMath';
import { TagFilterSelect } from './TagFilterSelect';
import { DecisionFilter, ViewOptions } from './PhotoViewControls';
import { SearchNote } from './SearchNote';
import PhotoQuickMenu from './PhotoQuickMenu';
import { useLongPress } from '../../../components/useLongPress';
import { readGesture } from '../../../core/gestureSettings';
import { createDoubleTapDetector } from '../../../core/touchGestures';
import { openPhotoMenuFromKeyboard } from '../../../components/PhotoContextMenu';

interface GridViewProps {
  photos: Photo[];
  activePhotoId: string | null;
  selectedPhotoIds: string[];
  filter: FilmstripFilter;
  search: string;
  /** Photos whose picture matches the search words (search by description); null: words only. */
  pictureIds?: ReadonlySet<string> | null;
  minRating: number;
  sort: PhotoSort;
  onSetMinRating: (rating: number) => void;
  onSetSort: (sort: PhotoSort) => void;
  tagFilter?: string | null;
  onSetTagFilter?: (tagId: string | null) => void;
  /** Saved views of these filters (a preview: absent while its flag is off). */
  savedViews?: import('./PhotoViewControls').SavedViewsControl;
  onSelectPhoto: (photoId: string, modifiers?: { ctrl?: boolean; shift?: boolean }) => void;
  onOpenInEditor: (photoId: string) => void;
  onToggleFlag: (photoIds: string[]) => void;
  /** Reject, set aside or return to review (the photo menu). */
  onSetDecision?: (photoIds: string[], decision: DecisionState) => void;
  /** Auto for one photo, when the editor offers it (the photo menu). */
  onAutoEdit?: (photoId: string) => void;
  onSetRating: (photoIds: string[], rating: number) => void;
  onSetFilter: (filter: FilmstripFilter) => void;
  onSetSearch: (q: string) => void;
  /** Finish my best (a preview: absent while its flag is off). */
  finishBest?: import('./FinishBestButton').FinishBestEntry;
  onClose: () => void;
}

/**
 * One photo's card. A long press on touch or pen, a right-click, the Menu key or Shift+F10 opens the photo menu; moving
 * the finger more than a few pixels (a scroll) cancels the press, so scrolling the gallery never opens a menu or a photo.
 */
function GalleryCard({ onMenu, onLongPressSelect, onDoubleTap, children, ...rest }: React.ComponentProps<'article'> & {
  onMenu: (x: number, y: number) => void;
  /** The person set a long press to Select (Settings > Gestures) instead of the menu. */
  onLongPressSelect: () => void;
  /** A double-tap, recognised from the touches so it works where `dblclick` is not sent for a touch (iOS, Android WebViews). */
  onDoubleTap: () => void;
}) {
  const press = useLongPress((point) => {
    const action = readGesture('photoList.longPress');
    if (action === 'menu') onMenu(point.x, point.y);
    else if (action === 'select') onLongPressSelect();
  }, true);
  const detector = React.useRef(createDoubleTapDetector());
  const down = React.useRef<{ x: number; y: number; t: number } | null>(null);
  const lastTouchDouble = React.useRef(Number.NEGATIVE_INFINITY);
  const lastPointer = React.useRef('mouse');
  return (
    <article {...rest} {...press}
      onPointerDown={(event) => { lastPointer.current = event.pointerType; if (event.pointerType === 'touch') down.current = { x: event.clientX, y: event.clientY, t: event.timeStamp }; press.onPointerDown?.(event); }}
      onPointerUp={(event) => {
        const start = down.current;
        down.current = null;
        if (event.pointerType === 'touch' && start && detector.current.lift(start, { x: event.clientX, y: event.clientY, t: event.timeStamp })) {
          lastTouchDouble.current = event.timeStamp;
          onDoubleTap();
        }
        press.onPointerUp?.();
      }}
      onPointerCancel={(event) => { down.current = null; detector.current.reset(); press.onPointerCancel?.(); }}
      onDoubleClickCapture={(event) => { if (event.timeStamp - lastTouchDouble.current < 800) { event.preventDefault(); event.stopPropagation(); } }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // A touch long press also raises this event (Android Chrome): it is the long-press gesture, which the pointer handler
        // above already acts on as Settings > Gestures says, so here only the menu choice answers it.
        const touch = lastPointer.current === 'touch' || lastPointer.current === 'pen';
        if (!touch || readGesture('photoList.longPress') === 'menu') onMenu(event.clientX, event.clientY);
      }}>
      {children}
    </article>
  );
}

export default function GridView({
  photos,
  activePhotoId,
  selectedPhotoIds,
  filter,
  search,
  pictureIds = null,
  minRating,
  sort,
  onSetMinRating,
  onSetSort,
  tagFilter = null,
  onSetTagFilter,
  savedViews,
  onSelectPhoto,
  onOpenInEditor,
  onToggleFlag,
  onSetDecision,
  onAutoEdit,
  onSetRating,
  onSetFilter,
  onSetSearch,
  finishBest,
  onClose,
}: GridViewProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; photoId: string } | null>(null);
  const openMenu = (photoId: string, x: number, y: number) => {
    if (!selectedPhotoIds.includes(photoId)) onSelectPhoto(photoId);
    setMenu({ x, y, photoId });
  };
  const visible = viewPhotos(photos, { filter, search, minRating, sort, tag: tagFilter, pictureIds });
  const flaggedCount = photos.filter((p) => p.decision === 'keep').length;

  return (
    <section
      aria-label={STRINGS.photoGrid.allPhotosGridView}
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
          <SearchNote photos={photos} search={search} pictureIds={pictureIds} className="max-w-md truncate" />
        </div>

        <div className="flex items-center gap-2">
          <DecisionFilter photos={photos} filter={filter} onSetFilter={onSetFilter} />
          <ViewOptions minRating={minRating} sort={sort} onSetMinRating={onSetMinRating} onSetSort={onSetSort} opensUp={false} savedViews={savedViews} />
              {onSetTagFilter && <TagFilterSelect photos={photos} value={tagFilter} onChange={onSetTagFilter} />}
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

          {finishBest && <FinishBestButton entry={finishBest} compact />}
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
            <span>{STRINGS.photoGrid.backToCanvas}</span>
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
                <GalleryCard
                  key={photo.id}
                  data-thumb-id={photo.id}
                  onMenu={(x, y) => openMenu(photo.id, x, y)}
                  onLongPressSelect={() => onSelectPhoto(photo.id, { ctrl: true })}
                  onDoubleTap={() => {
                    const action = readGesture('photoList.doubleTap');
                    if (action === 'open') onOpenInEditor(photo.id);
                    else if (action === 'menu') { const box = document.querySelector(`[data-thumb-id="${photo.id}"]`)?.getBoundingClientRect(); openMenu(photo.id, box ? box.left + box.width / 2 : 0, box ? box.top + box.height / 2 : 0); }
                  }}
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
                    onDoubleClick={(event) => {
                      const action = readGesture('photoList.doubleTap');
                      if (action === 'open') onOpenInEditor(photo.id);
                      else if (action === 'menu') openMenu(photo.id, event.clientX, event.clientY);
                    }}
                    onKeyDown={(event) => { openPhotoMenuFromKeyboard(event, (x, y) => openMenu(photo.id, x, y)); }}
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
                      <span className="absolute left-2 top-2 rounded bg-[var(--bg-scrim)] px-1.5 py-0.5 text-[0.625rem] font-medium text-white">
                        {STRINGS.shellLabels.activePhoto}
                      </span>
                    )}
                    <span
                      title={photo.state === 'unsupported' ? engineText.workspace.rawJpegXl : undefined}
                      className="absolute bottom-2 left-2 rounded bg-[var(--bg-scrim)] px-1.5 py-0.5 text-[0.625rem] font-medium text-white"
                    >
                      {stateWord}
                      {photo.state === 'unsupported' && <span className="sr-only">. {engineText.workspace.rawJpegXl}</span>}
                    </span>
                  </button>

                  <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-[var(--text-primary)]" title={photo.pairedJpeg ? STRINGS.pair.title(photo.filename, photo.pairedJpeg) : undefined}>
                        {photo.filename}{photo.pairedJpeg && <span className="ml-1.5 text-[0.625rem] font-semibold text-[var(--text-secondary)]">{STRINGS.pair.badge}</span>}
                      </p>
                      <PictureSourceBadge picture={photo.picture?.thumb} compact className="mt-1 text-[0.625rem]" />
                      <div className="mt-1 flex items-center gap-0.5" aria-label={`Rating ${photo.rating} of 5`}>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            aria-label={`Rate ${photo.filename} ${n} stars`}
                            aria-pressed={n === photo.rating}
                            // Choosing the rating a photo already has clears it, as in the Info panel (0 means unrated).
                            onClick={() => onSetRating([photo.id], n === photo.rating ? 0 : n)}
                            className="p-0.5 text-[var(--brand-accent)] hover:scale-110 transition-transform pointer-coarse:hidden"
                          >
                            <BrandIcon
                              name={n <= photo.rating ? 'star-filled' : 'star-empty'}
                              size={11}
                              className={n <= photo.rating ? 'text-[var(--brand-accent)]' : 'text-[var(--text-muted)]'}
                            />
                          </button>
                        ))}
                        {/* A finger cannot hit five stars this small; on touch the rating is shown here and set in the photo menu (long press or the ⋯ button), where each target is 44 px. */}
                        <span aria-hidden="true" className="hidden items-center gap-0.5 pointer-coarse:inline-flex">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <BrandIcon key={n} name={n <= photo.rating ? 'star-filled' : 'star-empty'} size={11}
                              className={n <= photo.rating ? 'text-[var(--brand-accent)]' : 'text-[var(--text-muted)]'} />
                          ))}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      aria-label={flagged ? `Unflag ${photo.filename}` : `Flag ${photo.filename}`}
                      onClick={() => onToggleFlag([photo.id])}
                      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] transition-colors pointer-coarse:h-11 pointer-coarse:w-11 ${
                        flagged
                          ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                          : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <BrandIcon name={flagged ? 'flag' : 'flag-off'} size={15} />
                    </button>
                    <button
                      type="button"
                      aria-haspopup="menu"
                      aria-label={`${STRINGS.filmstripLabels.label7}: ${photo.filename}`}
                      title={STRINGS.filmstripLabels.label7}
                      onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); openMenu(photo.id, box.left, box.bottom); }}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] pointer-coarse:h-11 pointer-coarse:w-11 focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]"
                    >
                      <span aria-hidden="true">⋯</span>
                    </button>
                    </div>
                  </div>
                </GalleryCard>
              );
            })}
          </div>
        )}
      </div>
      {menu && (() => {
        const target = photos.find((photo) => photo.id === menu.photoId);
        if (!target) return null;
        const ids = selectedPhotoIds.includes(target.id) ? selectedPhotoIds : [target.id];
        return (
          <PhotoQuickMenu x={menu.x} y={menu.y} photoName={target.filename} decision={target.decision} rating={target.rating} count={ids.length}
            onOpen={() => onOpenInEditor(target.id)}
            onToggleFlag={() => onToggleFlag(ids)}
            onSetDecision={(decision) => onSetDecision?.(ids, decision)}
            onSetRating={(rating) => onSetRating(ids, rating)}
            onAuto={onAutoEdit ? () => onAutoEdit(target.id) : undefined}
            onClose={() => setMenu(null)} />
        );
      })()}
    </section>
  );
}
