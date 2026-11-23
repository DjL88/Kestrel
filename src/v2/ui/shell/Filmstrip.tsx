import { planFilmstrip } from '../../engineClient/burstGroups';
import React, { useEffect, useRef, useState } from 'react';
import type { AssistMode, LookPreset, Photo } from '../contract';
import { STRINGS } from '../strings';
import ProBadge, { useProHidden } from './ProBadge';
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
  onSetBurstGrouped: (burstGroupId: string, grouped: boolean) => void;
  onRemovePhotos: (photoIds: string[]) => void;
  onPasteRecipe: () => void;
  onApplyLook: (photoId: string, lookId: string) => void;
  onImport: () => void;
  onImportFolder: () => void;
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
  onSetBurstGrouped,
  onRemovePhotos,
  onPasteRecipe,
  onApplyLook,
  onImport,
  onImportFolder,
  onRunAutoCull,
  onExportSelected,
}: FilmstripProps) {
  const hideAutoCull = useProHidden('smartCulling');
  const [searchOpen, setSearchOpen] = useState(false);
  const [photoView, setPhotoView] = useState<'filmstrip' | 'tiles'>('filmstrip');
  const [expandedBursts, setExpandedBursts] = useState<Set<string>>(() => new Set());
  const [minimumRating, setMinimumRating] = useState(0);
  const [tileMenu, setTileMenu] = useState<{ x: number; y: number; photoId: string } | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState<string[] | null>(null);
  const resizeStart = useRef<{ y: number; h: number } | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const touchPress = useRef<{ pointerId: number; x: number; y: number; photoId: string } | null>(null);
  const suppressTouchClick = useRef(false);

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    touchPress.current = null;
  };

  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
  }, []);

  const startLongPress = (event: React.PointerEvent<HTMLElement>, photoId: string) => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    cancelLongPress();
    suppressTouchClick.current = false;
    const { pointerId, clientX: x, clientY: y } = event;
    touchPress.current = { pointerId, x, y, photoId };
    longPressTimer.current = window.setTimeout(() => {
      const press = touchPress.current;
      if (!press || press.pointerId !== pointerId) return;
      suppressTouchClick.current = true;
      if (!selectedPhotoIds.includes(photoId)) onSelectPhoto(photoId);
      setTileMenu({ x: press.x, y: press.y, photoId });
      cancelLongPress();
    }, 500);
  };

  const moveLongPress = (event: React.PointerEvent<HTMLElement>) => {
    const press = touchPress.current;
    if (press && press.pointerId === event.pointerId &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
      cancelLongPress();
    }
  };

  useEffect(() => {
    if (!tileMenu) return;
    const close = () => {
      suppressTouchClick.current = false;
      setTileMenu(null);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    // The browser can target the release click at a menu item that appeared under the held finger.
    const suppressReleaseClick = (event: MouseEvent) => {
      if (!suppressTouchClick.current || event.detail === 0) return;
      suppressTouchClick.current = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    // A held touch can emit a compatibility mousedown on release. Only a new press dismisses the menu.
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onEscape);
    window.addEventListener('click', suppressReleaseClick, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onEscape);
      window.removeEventListener('click', suppressReleaseClick, true);
    };
  }, [tileMenu]);

  const visiblePhotos = filterPhotos(photos, filter, search).filter((photo) => photo.rating >= minimumRating);
  // Next and previous photo (a macro pad dial or command search) step through the photos shown here, so the filter and rating filter are respected.
  const stepRef = useRef({ visiblePhotos, activePhoto, onSelectPhoto });
  stepRef.current = { visiblePhotos, activePhoto, onSelectPhoto };
  useEffect(() => {
    const onStep = (event: Event) => {
      const delta = (event as CustomEvent<{ delta?: number }>).detail?.delta;
      if (delta !== 1 && delta !== -1) return;
      const { visiblePhotos: list, activePhoto: current, onSelectPhoto: select } = stepRef.current;
      if (list.length === 0) return;
      const index = list.findIndex((photo) => photo.id === current?.id);
      const next = list[Math.min(list.length - 1, Math.max(0, index < 0 ? (delta === 1 ? 0 : list.length - 1) : index + delta))];
      if (next && next.id !== current?.id) select(next.id);
    };
    window.addEventListener('inflight:photo-step', onStep);
    return () => window.removeEventListener('inflight:photo-step', onStep);
  }, []);
  const openIds = new Set<string>([...selectedPhotoIds, ...(activePhoto ? [activePhoto.id] : [])]);
  const items = planFilmstrip(visiblePhotos, expandedBursts, openIds);
  const planCoverId = (list: typeof items, groupId: string) => { const controls = list.find((entry) => entry.type === 'controls' && entry.groupId === groupId); return controls && controls.type === 'controls' ? controls.cover.id : undefined; };
  const setBurstOpen = (groupId: string, open: boolean) => setExpandedBursts((current) => { const next = new Set(current); if (open) next.add(groupId); else next.delete(groupId); return next; });
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

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    // Match the pointer direction: moving the separator upwards makes the dock taller.
    onSetHeight(height + (event.key === 'ArrowUp' ? 24 : -24));
  };


  return (
    <section
      aria-label="Filmstrip and photo info dock"
      className="v2-filmstrip relative z-20 flex shrink-0 flex-col border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] select-none"
    >
      {/* Top Resize Drag Bar */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize bottom panel"
          aria-valuenow={height}
          aria-valuetext={`${height} pixels high; use Up or Down arrow keys to resize`}
          tabIndex={0}
          onKeyDown={handleResizeKeyDown}
          onPointerDown={handleResizeDown}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
          onPointerCancel={handleResizeUp}
          className="flex h-2 w-full cursor-ns-resize items-center justify-center hover:bg-[var(--brand-accent-soft)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]"
        >
          <span className="h-0.5 w-10 rounded-full bg-[var(--border-default)]" />
        </div>
      )}

      {/* Dock Header Toolbar */}
      <div className="flex flex-nowrap items-center justify-between gap-2 overflow-x-auto px-3 py-1.5 border-b border-[var(--border-subtle)] inflight-scroll">
        {/* Left: Filmstrip / Info tabs + Import + Auto-Cull & Analyse */}
        <div className="flex items-center gap-2 min-w-0">

          <div role="group" aria-label="Photograph browsing view" className="inline-flex rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-0.5">
            {(['filmstrip', 'tiles'] as const).map((view) => (
              <button key={view} type="button" aria-pressed={photoView === view}
                onClick={() => { setPhotoView(view); if (collapsed) onSetCollapsed(false); }}
                className={`h-7 rounded px-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)] ${photoView === view ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                {view === 'filmstrip' ? 'Filmstrip' : 'Tiles'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onImport}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2 text-[11px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface-hover)] whitespace-nowrap"
          >
            <BrandIcon name="image-plus" size={13} />
            <span>{STRINGS.filmstrip.importPhotos}</span>
          </button>

          <button type="button" onClick={onImportFolder}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] px-2 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] whitespace-nowrap"
            title="Add photographs from a folder">
            <BrandIcon name="folder-open" size={13} />
            <span>Folder</span>
          </button>

          {!hideAutoCull && (
          <button
            type="button"
            onClick={onRunAutoCull}
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--brand-accent-soft)] px-2 text-[11px] font-medium text-[var(--brand-accent)] transition-colors hover:bg-[var(--brand-accent)] hover:text-[var(--text-on-accent)] whitespace-nowrap"
          >
            <BrandIcon name="find-subject" size={13} />
            <span>
              {STRINGS.filmstrip.autoCull}
              {assistMode === 'autopilot' ? ' · Auto' : ''}
            </span>
            <ProBadge feature="smartCulling" />
          </button>
          )}
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
        <div style={{ height: photoView === 'tiles' ? 'min(72dvh, calc(100dvh - 160px))' : height }} className="v2-filmstrip-body w-full overflow-hidden">
          {visiblePhotos.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
              {STRINGS.filmstrip.nothingMatches}
            </div>
          ) : (
            <div
              role="listbox"
              aria-label="Project photographs"
              aria-multiselectable="true"
              className={photoView === 'tiles'
                ? 'grid h-full auto-rows-[minmax(170px,210px)] grid-cols-[repeat(auto-fill,minmax(min(100%,170px),1fr))] content-start gap-2.5 overflow-y-auto inflight-scroll px-3 py-2'
                : 'flex h-full items-center gap-2.5 overflow-x-auto inflight-scroll px-3 py-2'}
            >
              {items.map((item) => {
                if (item.type === 'controls') {
                  return (
                    <div key={`burst-${item.groupId}`} role="group" aria-label={STRINGS.bursts.controls(item.count)} className={`${photoView === 'tiles' ? 'h-full w-full' : 'h-full w-40 shrink-0'} flex flex-col justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-[var(--brand-accent-border)] bg-[var(--bg-surface)] p-2`}>
                      <p className="text-[11px] font-semibold text-[var(--text-primary)]">{STRINGS.bursts.controls(item.count)}</p>
                      <button type="button" disabled={!item.best} title={item.best ? undefined : STRINGS.bursts.flagBestNotRanked}
                        onClick={() => { if (item.best) onSetDecision([item.best.id], 'keep'); }}
                        className="min-h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 text-[11px] font-medium text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50">{STRINGS.bursts.flagBest}</button>
                      {!item.best && <span className="text-[10px] leading-tight text-[var(--text-muted)]">{STRINGS.bursts.flagBestNotRanked}</span>}
                      <button type="button" onClick={() => onSetBurstGrouped(item.groupId, false)} className="min-h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 text-[11px] font-medium text-[var(--text-primary)]">{STRINGS.bursts.split}</button>
                      <button type="button" onClick={() => { onSelectPhoto(item.cover.id); setBurstOpen(item.groupId, false); }} className="min-h-8 rounded-[var(--radius-sm)] px-2 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">{STRINGS.bursts.collapse}</button>
                    </div>
                  );
                }
                const photo = item.photo;
                const stack = item.stack;
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
                    onPointerDown={(event) => startLongPress(event, photo.id)}
                    onPointerMove={moveLongPress}
                    onPointerUp={cancelLongPress}
                    onPointerCancel={cancelLongPress}
                    className={`group relative flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-md)] border transition-colors ${photoView === 'tiles' ? 'w-full' : 'w-36 shrink-0'} ${
                      isActive
                        ? 'border-[var(--brand-accent)] bg-[var(--bg-surface-raised)] ring-1 ring-[var(--brand-accent)]'
                        : isSelected
                        ? 'border-[var(--brand-accent-border)] bg-[var(--bg-surface-raised)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-input)] hover:border-[var(--border-default)]'
                    }`}
                  >
                    {stack && (
                      <button
                        type="button"
                        aria-expanded={stack.expanded}
                        aria-label={stack.expanded ? STRINGS.bursts.hide : STRINGS.bursts.show(stack.count)}
                        title={stack.expanded ? STRINGS.bursts.hide : STRINGS.bursts.show(stack.count)}
                        onClick={(event) => { event.stopPropagation(); if (stack.expanded) onSelectPhoto(planCoverId(items, stack.groupId) ?? photo.id); setBurstOpen(stack.groupId, !stack.expanded); }}
                        className="absolute left-1 top-1 z-10 min-h-9 rounded bg-[var(--bg-scrim)] px-2 text-[10px] font-semibold text-white"
                      >
                        {STRINGS.bursts.badge(stack.count)}{!stack.expanded ? ' ▸' : ''}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`More actions for ${photo.filename}`}
                      title="Photo actions"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!isSelected) onSelectPhoto(photo.id);
                        const bounds = event.currentTarget.getBoundingClientRect();
                        setTileMenu({ x: bounds.left, y: bounds.bottom, photoId: photo.id });
                      }}
                      className="absolute right-1 top-1 z-10 flex min-h-9 min-w-9 items-center justify-center rounded bg-[var(--bg-surface-raised)] text-xs font-bold text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]"
                    >
                      <span aria-hidden="true">⋯</span>
                    </button>
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
                    <div className="flex h-9 shrink-0 items-center justify-between gap-1 px-1">
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
                        className={`inline-flex min-h-9 min-w-9 items-center justify-center rounded transition-colors focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)] ${
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
      {tileMenu && (() => {
        const menuTargetIds = selectedPhotoIds.includes(tileMenu.photoId) ? selectedPhotoIds : [tileMenu.photoId];
        const menuTargetsAllSetAside = menuTargetIds.length > 0 &&
          menuTargetIds.every((id) => photos.find((p) => p.id === id)?.decision === 'reject');
        return (
        <div
          role="menu"
          aria-label="Photo actions"
          onPointerDown={(e) => {
            suppressTouchClick.current = false;
            e.stopPropagation();
          }}
          className="fixed z-50 w-56 max-h-[min(70dvh,16rem)] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] py-1.5 shadow-[var(--shadow-popover)] md:max-h-[70vh]"
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
          {photos.find((p) => p.id === tileMenu.photoId)?.burst?.ungrouped && (
            <button type="button" role="menuitem"
              onClick={() => {
                const groupId = photos.find((p) => p.id === tileMenu.photoId)?.burst?.groupId;
                if (groupId) onSetBurstGrouped(groupId, true);
                setTileMenu(null);
              }}
              className="flex w-full px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]">
              {STRINGS.bursts.regroup}
            </button>
          )}
          {menuTargetsAllSetAside && (
            <button type="button" role="menuitem"
              onClick={() => {
                setRemoveConfirm(menuTargetIds);
                setTileMenu(null);
              }}
              className="flex w-full px-3 py-2 text-left text-xs text-[var(--status-danger,#e5484d)] hover:bg-[var(--bg-surface-hover)]">
              Remove {menuTargetIds.length > 1 ? `${menuTargetIds.length} photos` : 'photo'}…
            </button>
          )}
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
        );
      })()}

      {/* Confirm before Trash: reversible (Undo brings it straight back), but still asks first like V1. */}
      {removeConfirm && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="remove-photos-title" aria-describedby="remove-photos-body"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-scrim)] p-4"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="w-full max-w-md space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-panel)]">
            <h2 id="remove-photos-title" className="text-base font-bold text-[var(--text-primary)]">
              {removeConfirm.length > 1 ? `Remove ${removeConfirm.length} photos?` : 'Remove this photo?'}
            </h2>
            <p id="remove-photos-body" className="text-sm leading-relaxed text-[var(--text-secondary)]">
              This takes {removeConfirm.length > 1 ? 'these set-aside photos' : 'this set-aside photo'} out of InFlight's catalogue. Your original file on disk is never touched, and Undo (Cmd/Ctrl+Z) brings it straight back.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setRemoveConfirm(null)}
                className="min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-4 text-xs font-medium text-[var(--text-primary)]">
                Keep photo{removeConfirm.length > 1 ? 's' : ''}
              </button>
              <button type="button" onClick={() => {
                  onRemovePhotos(removeConfirm);
                  setRemoveConfirm(null);
                }}
                className="min-h-10 rounded-[var(--radius-md)] bg-[var(--status-danger,#e5484d)] px-4 text-xs font-semibold text-white">
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
