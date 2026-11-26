import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FilmstripFilter, Photo, PhotoSort } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import { workflowText } from '../../../i18n/areas/workflow';
import { MAX_SAVED_VIEWS, deleteView, loadSavedViews, matchingView, saveView, storeSavedViews, type SavedView, type ViewCriteria } from '../../../core/savedViews';

/** Saved views (a preview behind its flag): what is shown now, and how to put a saved one back. */
export interface SavedViewsControl {
  current: ViewCriteria;
  onApply: (criteria: ViewCriteria) => void;
}

const deviceStorage = (): Storage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };
const newViewId = () => `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Name and keep the filters in force, and put a saved set back with one choice. Kept on this device only. */
function SavedViews({ control }: { control: SavedViewsControl }) {
  const [views, setViews] = useState<SavedView[]>(() => loadSavedViews(deviceStorage()));
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const shown = matchingView(views, control.current);
  const keep = (next: SavedView[], said: string) => {
    setViews(next);
    setMessage(storeSavedViews(deviceStorage(), next) ? said : workflowText.notStored);
  };
  const save = () => {
    const result = saveView(views, name, control.current, newViewId);
    if (!result.ok) {
      setMessage(result.reason === 'empty-name' ? workflowText.emptyName : result.reason === 'full' ? workflowText.full(MAX_SAVED_VIEWS) : workflowText.notStored);
      return;
    }
    keep(result.views, result.replaced ? workflowText.replaced(result.view.name) : workflowText.saved(result.view.name));
    setName('');
  };
  return (
    <section aria-label={workflowText.title} data-testid="saved-views" className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
      <h3 className="text-[0.6875rem] font-semibold text-[var(--text-secondary)]">{workflowText.title}</h3>
      {views.length === 0 ? <p className="text-[0.6875rem] text-[var(--text-muted)]">{workflowText.none}</p> : (
        <ul className="max-h-40 space-y-1 overflow-y-auto">
          {views.map((view) => (
            <li key={view.id} className="flex items-center gap-1">
              <button type="button" onClick={() => { control.onApply(view.criteria); setMessage(workflowText.showing(view.name)); }}
                aria-label={workflowText.show(view.name)} aria-current={shown?.id === view.id ? 'true' : undefined}
                className={`min-h-8 flex-1 truncate rounded-[var(--radius-sm)] px-2 text-left text-xs hover:bg-[var(--bg-surface-hover)] ${
                  shown?.id === view.id ? 'border border-[var(--border-default)] font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                {shown?.id === view.id && <span aria-hidden="true">✓ </span>}{view.name}
              </button>
              <button type="button" onClick={() => keep(deleteView(views, view.id), '')} aria-label={workflowText.remove(view.name)} title={workflowText.remove(view.name)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]">
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} aria-label={workflowText.nameLabel} placeholder={workflowText.nameLabel}
          data-testid="saved-view-name"
          className="h-8 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)]" />
        <button type="submit" className="h-8 shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
          {workflowText.save}
        </button>
      </form>
      <p role="status" className="min-h-[1rem] text-[0.6875rem] text-[var(--text-secondary)]">{message}</p>
      <p className="text-[0.6875rem] text-[var(--text-muted)]">{workflowText.hint}</p>
    </section>
  );
}

const SORTS: PhotoSort[] = ['shoot', 'captured-oldest', 'captured-newest', 'filename', 'rating', 'best'];

/** All / To review / Flagged / Set aside, each with its count, as one segmented control. Shared by the filmstrip and the grid. */
export function DecisionFilter({ photos, filter, onSetFilter, compact = false }: {
  photos: Photo[];
  filter: FilmstripFilter;
  onSetFilter: (filter: FilmstripFilter) => void;
  compact?: boolean;
}) {
  const counts = { 'to-review': 0, flagged: 0, 'set-aside': 0 };
  for (const photo of photos) {
    if (photo.decision === 'unreviewed') counts['to-review'] += 1;
    else if (photo.decision === 'keep') counts.flagged += 1;
    else if (photo.decision === 'reject') counts['set-aside'] += 1;
  }
  const options: { id: FilmstripFilter; label: string; count?: number }[] = [
    { id: 'all', label: STRINGS.filmstrip.filterAll },
    { id: 'to-review', label: STRINGS.filmstrip.filterToReview, count: counts['to-review'] },
    { id: 'flagged', label: STRINGS.filmstrip.filterFlagged, count: counts.flagged },
    { id: 'set-aside', label: STRINGS.filmstrip.filterSetAside, count: counts['set-aside'] },
  ];
  return (
    <div role="group" aria-label={STRINGS.filmstrip.filterByDecision}
      className="inline-flex rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-0.5">
      {options.map((option) => (
        <button key={option.id} type="button" aria-pressed={filter === option.id} data-testid={`decision-filter-${option.id}`}
          onClick={() => onSetFilter(option.id)}
          className={`${compact ? 'h-7 px-2' : 'px-2.5 py-1'} whitespace-nowrap rounded text-xs font-medium transition-colors ${
            filter === option.id
              ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          }`}>
          {option.label}
          {option.count !== undefined && <span className="tabular-nums"> ({option.count})</span>}
        </button>
      ))}
    </div>
  );
}

/** A "Sort and filter" button that opens rating and order choices. When either differs from the default, the button says so in words. */
export function ViewOptions({ minRating, sort, onSetMinRating, onSetSort, opensUp = true, savedViews }: {
  minRating: number;
  sort: PhotoSort;
  onSetMinRating: (rating: number) => void;
  onSetSort: (sort: PhotoSort) => void;
  /** The filmstrip sits at the bottom, so its menu opens upwards; the grid's header opens it downwards. */
  opensUp?: boolean;
  /** Saved views: present only while that preview is on. */
  savedViews?: SavedViewsControl;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ right: number; top: number; bottom: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const active: string[] = [];
  if (minRating > 0) active.push(STRINGS.filmstrip.ratingAtLeast(minRating));
  if (sort !== 'shoot') active.push(STRINGS.filmstrip.sortNames[sort]);
  const selectClass = 'h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)]';

  return (
    <div ref={wrapRef} className="relative">
      <button ref={buttonRef} type="button" aria-expanded={open} aria-controls={panelId} data-testid="view-options"
        title={STRINGS.filmstrip.viewOptions}
        aria-label={active.length ? `${STRINGS.filmstrip.viewOptions}: ${STRINGS.filmstrip.viewSummary(active)}` : STRINGS.filmstrip.viewOptions}
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) setAnchor({ right: Math.max(8, window.innerWidth - rect.right), top: rect.top, bottom: rect.bottom });
          setOpen((value) => !value);
        }}
        className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-xs font-medium hover:bg-[var(--bg-surface-hover)] ${
          active.length ? 'border border-[var(--border-default)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}>
        <BrandIcon name="sort" size={15} />
        {active.length > 0 && <span className="max-w-[12rem] truncate">{STRINGS.filmstrip.viewSummary(active)}</span>}
      </button>
      {open && anchor && createPortal(
        // In the workspace root, fixed to the viewport, so neither the filmstrip's clipped edge nor the canvas's toolbars can cover it.
        <div ref={panelRef} id={panelId} role="dialog" aria-label={STRINGS.filmstrip.viewOptions}
          style={opensUp ? { right: anchor.right, bottom: window.innerHeight - anchor.top + 4 } : { right: anchor.right, top: anchor.bottom + 4 }}
          className="fixed z-50 w-60 max-w-[calc(100vw-16px)] space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-3 shadow-[var(--shadow-popover)]">
          <label className="block space-y-1 text-[0.6875rem] text-[var(--text-secondary)]">
            <span>{STRINGS.filmstrip.ratingLabel}</span>
            <select autoFocus value={minRating} data-testid="view-min-rating" onChange={(event) => onSetMinRating(Number(event.target.value))} className={selectClass}>
              <option value={0}>{STRINGS.filmstrip.anyRating}</option>
              {[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{STRINGS.filmstrip.ratingAtLeast(rating)}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-[0.6875rem] text-[var(--text-secondary)]">
            <span>{STRINGS.filmstrip.sortLabel}</span>
            <select value={sort} data-testid="view-sort" onChange={(event) => onSetSort(event.target.value as PhotoSort)} className={selectClass}>
              {SORTS.map((id) => <option key={id} value={id}>{STRINGS.filmstrip.sortNames[id]}</option>)}
            </select>
          </label>
          {active.length > 0 && (
            <button type="button" onClick={() => { onSetMinRating(0); onSetSort('shoot'); }}
              className="text-xs font-medium text-[var(--brand-accent)] hover:underline">
              {STRINGS.filmstrip.resetView}
            </button>
          )}
          {savedViews && <SavedViews control={savedViews} />}
        </div>,
        document.querySelector('.inflight-v2') ?? document.body,
      )}
    </div>
  );
}
