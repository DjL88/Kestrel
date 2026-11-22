import React, { useEffect, useRef, useState } from 'react';
import type { AssistMode, LookPreset, Photo } from '../contract';
import { STRINGS } from '../strings';
import ProBadge from './ProBadge';
import BrandIcon from '../icons/BrandIcon';
import { filterPhotos } from '../utils/studioMath';

interface FilmstripProps {
  photos: Photo[];
  activePhoto: Photo | null;
  selectedPhotoIds: string[];
  assistMode: AssistMode;
  bottomTab: 'filmstrip' | 'info';
  collapsed: boolean;
  height: number;
  filter: 'all' | 'flagged' | 'set-aside';
  search: string;
  calmView: boolean;
  looks: LookPreset[];
  hasClipboardRecipe: boolean;
  onSetBottomTab: (tab: 'filmstrip' | 'info') => void;
  onSetCollapsed: (collapsed: boolean) => void;
  onSetHeight: (height: number) => void;
  onSetFilter: (filter: 'all' | 'flagged' | 'set-aside') => void;
  onSetSearch: (q: string) => void;
  onSelectPhoto: (photoId: string, modifiers?: { ctrl?: boolean; shift?: boolean }) => void;
  onClearSelection: () => void;
  onToggleFlag: (photoIds: string[]) => void;
  onSetRating: (photoIds: string[], rating: number) => void;
  onSetDecision: (photoIds: string[], decision: 'unreviewed' | 'keep' | 'reject') => void;
  onPasteRecipe: () => void;
  onApplyLook: (photoId: string, lookId: string) => void;
  onImport: () => void;
  onRunAutoCull: () => void;
  onExportSelected: () => void;
}

export default function Filmstrip({
  photos,
  activePhoto,
  selectedPhotoIds,
  assistMode,
  bottomTab,
  collapsed,
  height,
  filter,
  search,
  calmView,
  looks,
  hasClipboardRecipe,
  onSetBottomTab,
  onSetCollapsed,
  onSetHeight,
  onSetFilter,
  onSetSearch,
  onSelectPhoto,
  onClearSelection,
  onToggleFlag,
  onSetRating,
  onSetDecision,
  onPasteRecipe,
  onApplyLook,
  onImport,
  onRunAutoCull,
  onExportSelected,
}: FilmstripProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [minimumRating, setMinimumRating] = useState(0);
  const [tileMenu, setTileMenu] = useState<{ x: number; y: number; photoId: string } | null>(null);
  const resizeStart = useRef<{ y: number; h: number } | null>(null);
  const longPressTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!tileMenu) return;
    const close = () => setTileMenu(null);
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setTileMenu(null);
      }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onEscape);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onEscape);
    };
  }, [tileMenu]);

  const visiblePhotos = filterPhotos(photos, filter, search).filter((photo) => photo.rating >= minimumRating);
  const flaggedCount = photos.filter((p) => p.decision === 'keep').length;
  const setAsideCount = photos.filter((p) => p.decision === 'reject').length;

  const handleResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeStart.current = { y: e.clientY, h: height };
  };

  const handleResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeStart.current) return;
    const dy = resizeStart.current.y - e.clientY;
    onSetHeight(resizeStart.current.h + dy);
  };

  const handleResizeUp = () => {
    resizeStart.current = null;
  };


  return (
    <section
      aria-label="Filmstrip and photo info dock"
      className="relative z-20 flex shrink-0 flex-col border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] select-none"
    >
      {/* Top Resize Drag Bar */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize bottom panel"
          onPointerDown={handleResizeDown}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
          className="flex h-2 w-full cursor-ns-resize items-center justify-center hover:bg-[var(--brand-accent-soft)]"
        >
          <span className="h-0.5 w-10 rounded-full bg-[var(--border-default)]" />
        </div>
      )}

      {/* Dock Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 border-b border-[var(--border-subtle)]">
        {/* Left: Filmstrip / Info tabs + Import + Auto-Cull & Analyse */}
        <div className="flex items-center gap-2 min-w-0">
          <div
            role="tablist"
            aria-label="Bottom dock views"
            className="inline-flex rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={bottomTab === 'filmstrip' && !collapsed}
              onClick={() => onSetBottomTab('filmstrip')}
              className={`h-7 rounded px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
                bottomTab === 'filmstrip' && !collapsed
                  ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              Filmstrip ({photos.length})
            </button>
          </div>

          <button
            type="button"
            onClick={onImport}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface-hover)] whitespace-nowrap"
          >
            <BrandIcon name="image-plus" size={14} />
            <span>{STRINGS.filmstrip.importPhotos}</span>
          </button>

          <button
            type="button"
            onClick={onRunAutoCull}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--brand-accent-soft)] px-2.5 text-xs font-medium text-[var(--brand-accent)] transition-colors hover:bg-[var(--brand-accent)] hover:text-[var(--text-on-accent)] whitespace-nowrap"
          >
            <BrandIcon name="find-subject" size={14} />
            <span>
              {STRINGS.filmstrip.autoCull}
              {assistMode === 'autopilot' ? ' · Auto' : ''}
            </span>
            <ProBadge feature="smartCulling" />
          </button>
        </div>

        {/* Right: Multi-select batch actions OR Search + All/Flagged filter + Hide toggle */}
        <div className="flex items-center gap-2">
          {selectedPhotoIds.length > 1 && (
            <div className="flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--brand-accent-soft)] px-2 py-1 text-xs text-[var(--brand-accent)]">
              <span className="font-semibold tabular-nums">
                {STRINGS.filmstrip.selectedCount(selectedPhotoIds.length)}
              </span>
              <button
                type="button"
                onClick={() => onToggleFlag(selectedPhotoIds)}
                className="rounded px-1.5 py-0.5 font-medium hover:bg-[var(--bg-surface)]"
              >
                {STRINGS.filmstrip.flagAction}
              </button>
              <button
                type="button"
                onClick={onExportSelected}
                className="rounded px-1.5 py-0.5 font-medium hover:bg-[var(--bg-surface)]"
              >
                Export
              </button>
              <button
                type="button"
                onClick={onClearSelection}
                className="rounded px-1 py-0.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                {STRINGS.filmstrip.clearSelection}
              </button>
            </div>
          )}

          {/* Filter All / Flagged */}
          <div className="inline-flex rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-0.5">
            <button
              type="button"
              onClick={() => onSetFilter('all')}
              className={`h-7 rounded px-2 text-xs font-medium transition-colors ${
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
              className={`h-7 rounded px-2 text-xs font-medium transition-colors ${
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
            className={`h-8 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 text-xs font-medium ${filter === 'set-aside' ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
            Set aside ({setAsideCount})
          </button>

          {/* Search icon expanding into search input */}
          {searchOpen || search || minimumRating > 0 ? (
            <div className="relative flex items-center">
              <BrandIcon
                name="search"
                size={13}
                className="pointer-events-none absolute left-2.5 text-[var(--text-muted)]"
              />
              <input
                type="search"
                autoFocus
                value={search}
                onChange={(e) => onSetSearch(e.target.value)}
                onBlur={() => {
                  if (!search && minimumRating === 0) setSearchOpen(false);
                }}
                placeholder={STRINGS.filmstrip.searchPlaceholder}
                aria-label={STRINGS.filmstrip.searchPlaceholder}
                className="h-8 w-44 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] pl-7 pr-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            </div>
          ) : (
            <button
              type="button"
              aria-label={STRINGS.filmstrip.searchToggle}
              title={STRINGS.filmstrip.searchToggle}
              onClick={() => setSearchOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
            >
              <BrandIcon name="search" size={15} />
            </button>
          )}

          {(searchOpen || search || minimumRating > 0) && (
            <label className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
              <span>Rating</span>
              <select
                aria-label="Minimum photo rating"
                value={minimumRating}
                onChange={(event) => setMinimumRating(Number(event.target.value))}
                className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-1 text-xs text-[var(--text-primary)]"
              >
                <option value={0}>Any</option>
                {[1, 2, 3, 4, 5].map((rating) => (
                  <option value={rating} key={rating}>{rating}+ stars</option>
                ))}
              </select>
            </label>
          )}

          {/* Collapse / Expand chevron */}
          <button
            type="button"
            aria-label={collapsed ? STRINGS.filmstrip.expand : STRINGS.filmstrip.collapse}
            title={collapsed ? STRINGS.filmstrip.expand : STRINGS.filmstrip.collapse}
            onClick={() => onSetCollapsed(!collapsed)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <span className={`inline-flex transition-transform ${collapsed ? 'rotate-180' : ''}`}>
              <BrandIcon name="chevron" size={15} />
            </span>
          </button>
        </div>
      </div>

      {/* Body: Either Filmstrip tiles OR Bottom Info Tab */}
      {!collapsed && (
        <div style={{ height }} className="w-full overflow-hidden">
          {visiblePhotos.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
              {STRINGS.filmstrip.nothingMatches}
            </div>
          ) : (
            <div
              role="listbox"
              aria-label="Project photographs"
              aria-multiselectable="true"
              className="flex h-full items-center gap-2.5 overflow-x-auto inflight-scroll px-3 py-2"
            >
              {visiblePhotos.map((photo) => {
                const isActive = activePhoto?.id === photo.id;
                const isSelected = selectedPhotoIds.includes(photo.id);
                const flagged = photo.decision === 'keep';
                const stateLabel = STRINGS.filmstrip.tileStates[photo.state];

                return (
                  <div
                    key={photo.id}
                    role="option"
                    aria-selected={isSelected}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!isSelected) onSelectPhoto(photo.id);
                      setTileMenu({
                        x: Math.min(e.clientX, window.innerWidth - 200),
                        y: Math.max(12, e.clientY - 120),
                        photoId: photo.id,
                      });
                    }}
                    onTouchStart={() => {
                      longPressTimer.current = window.setTimeout(() => {
                        onSelectPhoto(photo.id, { ctrl: true });
                      }, 420);
                    }}
                    onTouchEnd={() => {
                      if (longPressTimer.current) {
                        clearTimeout(longPressTimer.current);
                        longPressTimer.current = null;
                      }
                    }}
                    className={`group relative flex h-full w-36 shrink-0 flex-col overflow-hidden rounded-[var(--radius-md)] border transition-colors ${
                      isActive
                        ? 'border-[var(--brand-accent)] bg-[var(--bg-surface-raised)] ring-1 ring-[var(--brand-accent)]'
                        : isSelected
                        ? 'border-[var(--brand-accent-border)] bg-[var(--bg-surface-raised)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-input)] hover:border-[var(--border-default)]'
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
                      className="relative flex-1 w-full overflow-hidden bg-[var(--bg-canvas)] text-left"
                    >
                      <img
                        src={photo.thumbUrl}
                        alt={photo.title}
                        referrerPolicy="no-referrer"
                        className={`h-full w-full object-cover ${
                          photo.state === 'unavailable' ? 'opacity-55' : ''
                        }`}
                      />
                      {/* Tile state word (always readable text, never colour alone) */}
                      {photo.tier && (
                        <span
                          data-testid="tier-badge"
                          title={`${STRINGS.tier.label}: ${STRINGS.tier[photo.tier]}`}
                          className="absolute right-1.5 bottom-1.5 rounded border border-[var(--brand-accent-border)] bg-[var(--bg-scrim)] px-1.5 py-0.5 text-[9px] font-semibold text-white"
                        >
                          {STRINGS.tier[photo.tier]}
                        </span>
                      )}
                      {(photo.state !== 'ready' || !calmView) && (
                        <span
                          className={`absolute left-1.5 bottom-1.5 rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                            photo.state === 'unavailable'
                              ? 'bg-[var(--semantic-warning)] text-[#140d0a]'
                              : photo.state === 'importing' || photo.state === 'analysing'
                              ? 'bg-[var(--semantic-info)] text-[#09121a]'
                              : 'bg-[var(--bg-scrim)] text-white'
                          }`}
                        >
                          {stateLabel}
                        </span>
                      )}
                    </button>

                    {/* Tile footer: filename + flag toggle */}
                    <div className="flex h-7 shrink-0 items-center justify-between gap-1 px-2">
                      <span className="truncate font-mono text-[10px] text-[var(--text-secondary)]">
                        {photo.filename}
                      </span>
                      <button
                        type="button"
                        aria-label={flagged ? `Unflag ${photo.filename}` : `Flag ${photo.filename}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFlag([photo.id]);
                        }}
                        className={`inline-flex h-5 w-5 items-center justify-center rounded transition-colors ${
                          flagged
                            ? 'text-[var(--brand-accent)]'
                            : 'text-[var(--text-muted)] opacity-60 hover:opacity-100 hover:text-[var(--text-primary)]'
                        }`}
                      >
                        <BrandIcon name={flagged ? 'flag' : 'flag-off'} size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* V2 photo / multi-selection context menu: actions reuse the editor store. */}
      {tileMenu && (
        <div
          role="menu"
          aria-label="Photo actions"
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-50 w-56 max-h-[70vh] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] py-1.5 shadow-[var(--shadow-popover)]"
          style={{ left: Math.max(8, Math.min(tileMenu.x, window.innerWidth - 232)), top: Math.max(8, Math.min(tileMenu.y, window.innerHeight - 270)) }}
        >
          <p className="px-3 py-1 text-[11px] text-[var(--text-muted)]">
            {selectedPhotoIds.includes(tileMenu.photoId) && selectedPhotoIds.length > 1
              ? `${selectedPhotoIds.length} selected photos`
              : 'Photo actions'}
          </p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onToggleFlag(selectedPhotoIds.includes(tileMenu.photoId) ? selectedPhotoIds : [tileMenu.photoId]);
              setTileMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
          >
            <BrandIcon name="flag" size={14} />
            <span>Flag / unflag</span>
          </button>
          <button type="button" role="menuitem"
            onClick={() => {
              onSetDecision(selectedPhotoIds.includes(tileMenu.photoId) ? selectedPhotoIds : [tileMenu.photoId], 'reject');
              setTileMenu(null);
            }}
            className="flex w-full px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
            Reject / set aside
          </button>
          <button type="button" role="menuitem"
            onClick={() => {
              onSetDecision(selectedPhotoIds.includes(tileMenu.photoId) ? selectedPhotoIds : [tileMenu.photoId], 'unreviewed');
              setTileMenu(null);
            }}
            className="flex w-full px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
            Return to review
          </button>
          <div className="border-t border-[var(--border-subtle)] px-3 py-2">
            <span className="mb-1 block text-[11px] text-[var(--text-secondary)]">Rating</span>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Set photo rating">
              {[0, 1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  type="button"
                  aria-label={rating === 0 ? 'Clear rating' : `Rate ${rating} stars`}
                  title={rating === 0 ? 'Clear rating' : `${rating} stars`}
                  onClick={() => {
                    onSetRating(selectedPhotoIds.includes(tileMenu.photoId) ? selectedPhotoIds : [tileMenu.photoId], rating);
                    setTileMenu(null);
                  }}
                  className="min-h-8 min-w-7 rounded border border-[var(--border-subtle)] px-1 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
                >
                  {rating === 0 ? '–' : rating}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            disabled={!hasClipboardRecipe}
            onClick={() => {
              onPasteRecipe();
              setTileMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <BrandIcon name="paste" size={14} />
            <span>Paste settings</span>
          </button>
          <label className="block px-3 py-1.5 text-[11px] text-[var(--text-secondary)]">
            Apply Look
            <select
              aria-label="Apply a Look to selected photos"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) onApplyLook(tileMenu.photoId, event.target.value);
                setTileMenu(null);
              }}
              className="mt-1 h-8 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-primary)]"
            >
              <option value="" disabled>Choose a Look…</option>
              {looks.map((look) => <option key={look.id} value={look.id}>{look.name}</option>)}
            </select>
          </label>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onExportSelected();
              setTileMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
          >
            <BrandIcon name="export" size={14} />
            <span>Export selected…</span>
          </button>
        </div>
      )}
    </section>
  );
}
