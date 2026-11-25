import React, { useEffect, useRef } from 'react';
import type { DecisionState, Photo, PhotoSurfaceProps } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import { buildPreviewFilterCss } from '../utils/studioMath';

interface PairCompareProps {
  /** The two photos, left then right, in the order they were selected. */
  photos: [Photo, Photo];
  /** The photo keys and the rating and flag shortcuts act on. */
  chosenId: string | null;
  PhotoSurface?: React.ComponentType<PhotoSurfaceProps>;
  onChoose: (photoId: string) => void;
  onSetDecision: (photoIds: string[], decision: DecisionState) => void;
  onSetRating: (photoIds: string[], rating: number) => void;
  onSwap: () => void;
  onEdit: (photoId: string) => void;
  onClose: () => void;
}

/**
 * Two different photos side by side, so a person can pick the better of two frames (V1's two-photo compare).
 * Each side has its own decision and rating; nothing is decided for either photo until the person chooses.
 * The chosen side is marked with a word and a thicker border, never by colour alone.
 */
export default function PairCompare({ photos, chosenId, PhotoSurface, onChoose, onSetDecision, onSetRating, onSwap, onEdit, onClose }: PairCompareProps) {
  const paneRefs = useRef<(HTMLElement | null)[]>([]);
  const t = STRINGS.pairCompare;
  const decisionWord: Record<DecisionState, string> = { unreviewed: STRINGS.filmstrip.filterToReview, keep: STRINGS.filmstrip.filterFlagged, reject: STRINGS.filmstrip.filterSetAside };

  // Left and right arrows move between the two sides. Typing in a field is left alone.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const side = event.key === 'ArrowLeft' ? 0 : 1;
      event.preventDefault();
      event.stopPropagation();
      onChoose(photos[side].id);
      paneRefs.current[side]?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [photos, onChoose]);

  const button = 'inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]';

  return (
    <section aria-label={t.title} data-testid="pair-compare" className="flex flex-1 flex-col overflow-hidden bg-[var(--bg-canvas)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t.title}</h2>
          <p className="text-[0.6875rem] text-[var(--text-muted)]">{t.hint}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onSwap} className={button}>
            <BrandIcon name="arrows-horizontal" size={13} />
            <span>{t.swap}</span>
          </button>
          <button type="button" onClick={onClose} className={button}>
            <BrandIcon name="close" size={13} />
            <span>{t.close}</span>
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 md:flex-row sm:gap-3 sm:p-3">
        {photos.map((photo, side) => {
          const chosen = photo.id === chosenId;
          const recipe = photo.editGroups.find((group) => group.id === photo.activeGroupId)?.recipe;
          const ratio = photo.pixelSize ? `${photo.pixelSize.width} / ${photo.pixelSize.height}` : '3 / 2';
          return (
            <article key={photo.id} ref={(el) => { paneRefs.current[side] = el; }} tabIndex={0}
              aria-label={`${side === 0 ? t.left : t.right}: ${photo.filename}${chosen ? `, ${t.chosen}` : ''}`}
              data-testid={`pair-pane-${side}`} data-chosen={chosen ? 'true' : 'false'}
              onPointerDown={() => onChoose(photo.id)} onFocus={() => onChoose(photo.id)}
              className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-md)] bg-[var(--bg-surface)] focus-visible:outline-none ${
                chosen ? 'border-[3px] border-[var(--brand-accent)]' : 'border border-[var(--border-subtle)]'
              }`}>
              <div className="relative flex min-h-0 flex-1 items-center justify-center p-2">
                <div className="relative max-h-full max-w-full" style={{ aspectRatio: ratio, height: '100%' }}>
                  {PhotoSurface ? (
                    <PhotoSurface photoId={photo.id} variant="edited" alt={photo.filename} className="h-full w-full" />
                  ) : (
                    <img src={photo.previewUrl} alt={photo.filename} draggable={false} referrerPolicy="no-referrer"
                      className="h-full w-full object-contain" style={recipe ? { filter: buildPreviewFilterCss(recipe) } : undefined} />
                  )}
                </div>
                {chosen && (
                  <span className="pointer-events-none absolute left-3 top-3 rounded bg-[var(--brand-accent)] px-2 py-0.5 text-[0.625rem] font-semibold text-[var(--text-on-accent)]">
                    {t.chosen}
                  </span>
                )}
              </div>
              <div className="space-y-1.5 border-t border-[var(--border-subtle)] px-3 py-2">
                <div className="flex min-w-0 items-baseline gap-2">
                  <p className="min-w-0 truncate text-xs font-medium text-[var(--text-primary)]" title={photo.filename}>{photo.filename}</p>
                  <p className="shrink-0 text-[0.6875rem] text-[var(--text-muted)]" data-testid={`pair-decision-${side}`}>
                    {decisionWord[photo.decision]}{photo.tier ? ` · ${STRINGS.tier[photo.tier]}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                <div role="group" aria-label={t.ratingFor(photo.filename)} className="mr-auto flex items-center">
                  {[1, 2, 3, 4, 5].map((stars) => (
                    <button key={stars} type="button" aria-pressed={photo.rating === stars} aria-label={t.rate(stars)} title={t.rate(stars)}
                      onClick={(event) => { event.stopPropagation(); onSetRating([photo.id], photo.rating === stars ? 0 : stars); }}
                      className="inline-flex h-8 w-6 items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                      <BrandIcon name={photo.rating >= stars ? 'star-filled' : 'star-empty'} size={13} />
                    </button>
                  ))}
                </div>
                <button type="button" aria-pressed={photo.decision === 'keep'} data-testid={`pair-flag-${side}`}
                  onClick={(event) => { event.stopPropagation(); onSetDecision([photo.id], photo.decision === 'keep' ? 'unreviewed' : 'keep'); }}
                  className={`${button} ${photo.decision === 'keep' ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]' : ''}`}>
                  <BrandIcon name={photo.decision === 'keep' ? 'flag' : 'flag-off'} size={13} />
                  <span>{photo.decision === 'keep' ? t.unflag : t.flag}</span>
                </button>
                <button type="button" aria-pressed={photo.decision === 'reject'} data-testid={`pair-aside-${side}`}
                  onClick={(event) => { event.stopPropagation(); onSetDecision([photo.id], photo.decision === 'reject' ? 'unreviewed' : 'reject'); }}
                  className={`${button} ${photo.decision === 'reject' ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]' : ''}`}>
                  <span>{photo.decision === 'reject' ? t.putBack : t.setAside}</span>
                </button>
                <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(photo.id); }} className={button}>
                  <BrandIcon name="pencil" size={13} />
                  <span>{t.edit}</span>
                </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
