import { useEffect, useRef, useState } from 'react';
import { ArchiveRestore, ArrowLeft, Download, Ellipsis, Eraser, FileDown, FolderInput, Info, Keyboard, ListChecks, Pencil, Plus, Redo2, Save, ScanSearch, Trash2, Undo2 } from 'lucide-react';
import type { ProjectSettings } from '../core/projectSettings';
import { AppearanceSettings } from './AppearanceSettings';
import { isDesktopApp } from '../providers/desktopShell';
import { messages as m } from '../i18n/messages';
import type { CullCounts, FilterState, RatingFilter, ShootDescriptor, SortOrder, WorkspaceViewMode } from '../core/types';
import { FilterSortControl } from './FilterSortControl';

interface TopWorkspaceBarProps {
  shoot: ShootDescriptor;
  counts: CullCounts;
  filter: FilterState;
  onFilterChange: (next: FilterState) => void;
  searchQuery: string;
  ratingFilter: RatingFilter | null;
  onRatingFilterChange: (filter: RatingFilter | null) => void;
  onSearchChange: (q: string) => void;
  cameraFilter: string | null;
  onCameraFilterChange: (camera: string | null) => void;
  lensFilter: string | null;
  onLensFilterChange: (lens: string | null) => void;
  cameraOptions: string[];
  lensOptions: string[];
  sortOrder: SortOrder | undefined;
  onSortOrderChange: (order: SortOrder | undefined) => void;
  keeperTarget: number;
  onKeeperTargetChange: (target: number) => void;
  viewMode: WorkspaceViewMode;
  onViewModeChange: (mode: WorkspaceViewMode) => void;
  showShortcutsOverlay: boolean;
  onToggleShortcutsOverlay: () => void;
  onAutoCull: () => void;
  onBackupProject: () => void;
  watching?: string | null;
  onWatchFolder?: () => void;
  onSyncFolder?: () => void;
  onLocations?: () => void;
  /** Which hand the person uses, and how to change it. */
  hand?: 'left' | 'right';
  onHandChange?: (hand: 'left' | 'right') => void;
  onBackToProjects: () => void;
  actionsDisabled: boolean;
  /** Only adding more photos waits while an import runs; everything else stays usable. */
  addDisabled?: boolean;
  onOpenShootModal: () => void;
  onOpenMacroPadModal: () => void;
  onEditPhoto?: () => void;
  multiSelect: boolean;
  onToggleMultiSelect?: () => void;
  showFilmstrip: boolean;
  onToggleFilmstrip: () => void;
  showPhotoInfo: boolean;
  onTogglePhotoInfo: () => void;
  autoAdvance: boolean;
  onToggleAutoAdvance: () => void;
  onClearDecision?: () => void;
  onMoveToProject?: () => void;
  /** Exports what is selected: the selected photos, else the current photo. */
  onExport?: () => void;
  exportLabel?: string;
  /** What Undo and Redo would do, in words. */
  undoLabel?: string;
  redoLabel?: string;
  settings?: ProjectSettings;
  onSettingsChange?: (settings: ProjectSettings) => void;
  editPanelSide: 'left' | 'right';
  onEditPanelSideChange: (side: 'left' | 'right') => void;
  onRemoveFromLibrary?: () => void;
  removedCount?: number;
  onOpenRemoved?: () => void;
  onExportKeepers?: () => void;
  onBatchLook?: () => void;
  onAutoAdjustKeepers?: () => void;
  onUndo?: () => void;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  onRedo?: () => void;
  loadingProgress?: { loaded: number; total: number } | null;
}

const filterLabels: Record<FilterState, string> = {
  all: m.allPhotos, unreviewed: m.review, keep: m.keepers, reject: m.trash,
};

const viewLabels: Record<WorkspaceViewMode, string> = {
  loupe: 'Single photo', grid: 'Grid', compare: 'Compare',
};

function MenuSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-white/10 pt-2">
      <h3 id={id} className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h3>
      <div className="grid grid-cols-2 gap-1">{children}</div>
    </section>
  );
}

function MenuItem({ icon, children, onClick, disabled, pressed, wide }: {
  icon: React.ReactNode; children: React.ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean; wide?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={pressed}
      className={`flex min-h-10 min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:text-zinc-500 disabled:hover:bg-transparent aria-pressed:bg-sky-300/15 ${wide ? 'col-span-2' : ''}`}>
      <span className="shrink-0 text-zinc-400">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

const actionClass = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300';

export function TopWorkspaceBar(props: TopWorkspaceBarProps) {
  const {
    shoot, counts, filter, searchQuery, viewMode, keeperTarget, showShortcutsOverlay,
    loadingProgress, onEditPhoto, showPhotoInfo, autoAdvance,
  } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const footerMore = useRef<HTMLButtonElement>(null);
  const restoreMenuFocus = () => (footerMore.current?.getClientRects().length ? footerMore.current : triggerRef.current)?.focus();

  useEffect(() => {
    if (!menuOpen) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !footerMore.current?.contains(event.target)) setMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // One Escape closes one layer: mark it handled so the app does not also close Photo info or leave the editor.
      event.preventDefault();
      setMenuOpen(false);
      restoreMenuFocus();
    }
    document.addEventListener('pointerdown', closeOutside);
    // Capture phase, so the menu sees Escape before the app-wide shortcut listener.
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [menuOpen]);

  function choose(action: () => void, restoreFocus = true) {
    action();
    setMenuOpen(false);
    if (restoreFocus) restoreMenuFocus();
  }

  return (
    <>
    <header className="relative z-20 flex min-w-0 shrink-0 items-center justify-between gap-3 py-1.5 border-b border-white/8 bg-kestrel-panel px-2 sm:px-4">
      <button type="button" onClick={props.onBackToProjects} disabled={props.actionsDisabled} className={actionClass} aria-label="Back to projects" title="Back to projects">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">Projects</span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-zinc-100" title={shoot.title}>{shoot.title}</div>
        <div className="truncate text-xs text-zinc-400">
          {loadingProgress ? `Adding photos ${loadingProgress.loaded}/${loadingProgress.total}` :
            shoot.inbox ? `${counts.all} ${counts.all === 1 ? 'photo' : 'photos'}${searchQuery ? ' · Search active' : ''}${props.ratingFilter || props.cameraFilter || props.lensFilter ? ' · Filters active' : ''}` : `${shoot.sourceKind === 'demo' ? 'Demo · ' : ''}${counts.keep}/${keeperTarget} keepers${filter === 'all' || filter === 'reject' ? ` · ${filterLabels[filter]}` : ''}${searchQuery ? ' · Search active' : ''}${props.ratingFilter || props.cameraFilter || props.lensFilter ? ' · Filters active' : ''}`}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={props.onOpenShootModal} disabled={props.actionsDisabled || props.addDisabled} className={`${actionClass} border border-white/12 max-md:hidden`} aria-label="Add photos to project" title="Add photos">
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Add</span>
        </button>
        <button type="button" onClick={onEditPhoto} disabled={!onEditPhoto || props.actionsDisabled} aria-label="Edit" title="Open the selected photo in the editor"
          className={`${actionClass} border border-sky-300/50 text-sky-100 hover:bg-sky-300/15 disabled:opacity-40 max-md:hidden`}>
          <Pencil className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">Edit</span>
        </button>
        <button type="button" onClick={props.onExport} disabled={!props.onExport || props.actionsDisabled} aria-label={props.exportLabel ?? 'Export'} title="Export the selected photos"
          className={`${actionClass} bg-kestrel-copper font-semibold text-zinc-950 hover:bg-kestrel-copper-hover! disabled:opacity-40 max-md:hidden`}>
          <Download className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{props.exportLabel ?? 'Export'}</span>
          <span className="tabular-nums sm:hidden" aria-hidden="true">{props.exportLabel?.replace('Export', '').trim()}</span>
        </button>
        <div ref={menuRef}>
          <button ref={triggerRef} data-focus-fallback type="button" disabled={props.actionsDisabled} className={`${actionClass} max-md:hidden`} onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Workspace options" title="Workspace options" aria-expanded={menuOpen} aria-controls="workspace-options">
            <Ellipsis className="h-5 w-5" aria-hidden="true" />
          </button>
          {menuOpen && (
            <div id="workspace-options" data-workspace-options className="workspace-popover fixed inset-x-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 max-h-[70dvh] md:absolute md:inset-x-auto md:bottom-auto md:right-2 md:top-full md:mt-1 md:max-h-[calc(100dvh-8rem)] md:w-[min(26rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border border-white/12 bg-kestrel-raised p-3 shadow-2xl sm:right-4">
              <div className="space-y-3">
                <section aria-label="Find photos" className="md:hidden">
                  <FilterSortControl searchQuery={searchQuery} onSearchChange={props.onSearchChange}
                    ratingFilter={props.ratingFilter} onRatingFilterChange={props.onRatingFilterChange}
                    cameraFilter={props.cameraFilter} onCameraFilterChange={props.onCameraFilterChange}
                    lensFilter={props.lensFilter} onLensFilterChange={props.onLensFilterChange}
                    cameraOptions={props.cameraOptions} lensOptions={props.lensOptions}
                    sortOrder={props.sortOrder} onSortOrderChange={props.onSortOrderChange}
                    className="flex-wrap" />
                </section>

                <section aria-labelledby="menu-view" className="grid grid-cols-2 gap-2">
                  <h3 id="menu-view" className="sr-only">View</h3>
                  <label className="text-xs font-medium text-zinc-400">
                    Show
                    <select aria-label="Show photos" value={filter} onChange={(event) => choose(() => props.onFilterChange(event.target.value as FilterState))}
                      className="mt-1 min-h-10 w-full rounded-md border border-white/10 bg-kestrel-panel ps-2 text-sm text-zinc-100">
                      {Object.entries(filterLabels).map(([id, label]) => <option key={id} value={id}>{label} ({counts[id as FilterState]})</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-zinc-400">
                    View
                    <select aria-label="View" value={viewMode} onChange={(event) => choose(() => props.onViewModeChange(event.target.value as WorkspaceViewMode))}
                      className="mt-1 min-h-10 w-full rounded-md border border-white/10 bg-kestrel-panel ps-2 text-sm text-zinc-100">
                      {Object.entries(viewLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                  </label>
                </section>

                <MenuSection id="menu-history" title="Undo and redo">
                  <MenuItem wide icon={<Undo2 className="h-4 w-4" aria-hidden="true" />} disabled={!props.onUndo}
                    onClick={() => choose(() => props.onUndo?.())}>{props.undoLabel ? `Undo: ${props.undoLabel}` : 'Nothing to undo'}</MenuItem>
                  <MenuItem wide icon={<Redo2 className="h-4 w-4" aria-hidden="true" />} disabled={!props.onRedo}
                    onClick={() => choose(() => props.onRedo?.())}>{props.redoLabel ? `Redo: ${props.redoLabel}` : 'Nothing to redo'}</MenuItem>
                </MenuSection>

                <MenuSection id="menu-selection" title="Photos">
                  {props.onToggleMultiSelect && <MenuItem icon={<ListChecks className="h-4 w-4" aria-hidden="true" />} onClick={() => choose(() => props.onToggleMultiSelect?.())}>
                    {props.multiSelect ? 'Done selecting' : 'Select photos'}</MenuItem>}
                  <MenuItem icon={<Eraser className="h-4 w-4" aria-hidden="true" />} disabled={!props.onClearDecision} onClick={() => choose(() => props.onClearDecision?.())}>Clear decision</MenuItem>
                  <MenuItem icon={<FolderInput className="h-4 w-4" aria-hidden="true" />} disabled={!props.onMoveToProject} onClick={() => choose(() => props.onMoveToProject?.(), false)}>Move to project…</MenuItem>
                  <MenuItem icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} disabled={!props.onRemoveFromLibrary} onClick={() => choose(() => props.onRemoveFromLibrary?.(), false)}>Remove from library…</MenuItem>
                  <MenuItem icon={<ArchiveRestore className="h-4 w-4" aria-hidden="true" />} disabled={!props.onOpenRemoved} onClick={() => choose(() => props.onOpenRemoved?.(), false)}>Removed photos ({props.removedCount ?? 0})</MenuItem>
                  <MenuItem icon={<Info className="h-4 w-4" aria-hidden="true" />} pressed={showPhotoInfo} onClick={() => choose(props.onTogglePhotoInfo)}>{showPhotoInfo ? 'Hide photo info' : 'Photo info'}</MenuItem>
                </MenuSection>


                <MenuSection id="menu-project" title={shoot.inbox ? 'Quick edits' : 'Project'}>
                  {!shoot.inbox && <MenuItem icon={<ScanSearch className="h-4 w-4" aria-hidden="true" />} onClick={() => choose(props.onAutoCull, false)}>{m.autoCull}</MenuItem>}
                  <MenuItem icon={<Pencil className="h-4 w-4" aria-hidden="true" />} disabled={!props.onBatchLook} onClick={() => choose(() => props.onBatchLook?.(), false)}>Apply recipe to keepers…</MenuItem>
                  <MenuItem icon={<Pencil className="h-4 w-4" aria-hidden="true" />} disabled={!props.onAutoAdjustKeepers} onClick={() => choose(() => props.onAutoAdjustKeepers?.(), false)}>Auto-adjust unedited keepers…</MenuItem>
                  <MenuItem icon={<FileDown className="h-4 w-4" aria-hidden="true" />} disabled={!props.onExportKeepers} onClick={() => choose(() => props.onExportKeepers?.())}>Export keepers</MenuItem>
                  {!shoot.inbox && <MenuItem icon={<Save className="h-4 w-4" aria-hidden="true" />} onClick={() => choose(props.onBackupProject)}>Back up project</MenuItem>}
                  {props.onWatchFolder && <MenuItem icon={<FolderInput className="h-4 w-4" aria-hidden="true" />} onClick={() => choose(props.onWatchFolder!, props.watching ? true : false)}>{props.watching ? `Stop watching “${props.watching}”` : 'Watch a folder for new photos…'}</MenuItem>}
                  {props.onLocations && <MenuItem icon={<FolderInput className="h-4 w-4" aria-hidden="true" />} onClick={() => choose(props.onLocations!, false)}>Where this project is kept…</MenuItem>}
                  {props.onSyncFolder && <MenuItem icon={<FolderInput className="h-4 w-4" aria-hidden="true" />} onClick={() => choose(props.onSyncFolder!, false)}>Sync folder or cloud (experimental)…</MenuItem>}
                </MenuSection>

                <details className="border-t border-white/10 pt-1" open>
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-zinc-200">Settings: appearance, layout & shortcuts</summary>
                  <label className="flex min-h-9 items-center gap-2 px-1 pb-2 text-sm">
                    <input type="checkbox" checked={props.showFilmstrip} onChange={props.onToggleFilmstrip} />
                    Pin filmstrip
                  </label>
                  <label className="flex min-h-9 items-center gap-2 px-1 pb-2 text-sm">
                    <input type="checkbox" checked={props.focusMode} onChange={props.onToggleFocusMode} />
                    Focus mode
                  </label>
                  <AppearanceSettings side={props.editPanelSide} onSideChange={props.onEditPanelSideChange} hand={props.hand} onHandChange={props.onHandChange} />
                  {isDesktopApp() && <button type="button" onClick={() => choose(props.onOpenMacroPadModal, false)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-zinc-200 hover:bg-white/10">
                    <Keyboard className="h-4 w-4" aria-hidden="true" />Macro pad & keyboard shortcuts…
                  </button>}
                </details>
                <details className="border-t border-white/10 pt-1">
                  <summary className="min-h-10 cursor-pointer py-2 text-sm text-zinc-300">Culling settings</summary>
                  <div className="space-y-2 px-1 pb-2 text-sm">
                    <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={autoAdvance} onChange={props.onToggleAutoAdvance} />Auto-advance</label>
                    {props.settings && props.onSettingsChange && <>
                      <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={props.settings.autoCull}
                        onChange={(event) => props.onSettingsChange?.({ ...props.settings!, autoCull: event.target.checked })} />Auto-cull after adding photos</label>
                      <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={props.settings.autoEdit}
                        onChange={(event) => props.onSettingsChange?.({ ...props.settings!, autoEdit: event.target.checked })} />Auto-edit when first opening a photo</label>
                    </>}
                    <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={showShortcutsOverlay} onChange={props.onToggleShortcutsOverlay} />Show shortcut guide</label>
                    {!shoot.inbox && <label className="flex items-center justify-between gap-2">
                      Keeper target
                      <input type="number" min={1} max={9999} value={keeperTarget}
                        onChange={(event) => {
                          const next = event.target.valueAsNumber;
                          if (Number.isInteger(next) && next >= 1 && next <= 9999) props.onKeeperTargetChange(next);
                        }}
                        className="min-h-9 w-20 rounded-md border border-white/10 bg-black/20 px-2 text-right" />
                    </label>}
                  </div>
                </details>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
    <div role="toolbar" aria-label="Photo actions" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-white/10 bg-kestrel-panel pb-[env(safe-area-inset-bottom)] md:hidden">
      {([
        { key: 'add', label: 'Add', title: 'Add photos', Icon: Plus, onClick: props.onOpenShootModal, disabled: props.actionsDisabled || props.addDisabled },
        { key: 'edit', label: 'Edit', title: 'Open the selected photo in the editor', Icon: Pencil, onClick: onEditPhoto, disabled: !onEditPhoto || props.actionsDisabled },
        { key: 'export', label: props.exportLabel ?? 'Export', title: 'Export the selected photos', Icon: Download, onClick: props.onExport, disabled: !props.onExport || props.actionsDisabled },
      ] as const).map(({ key, label, title, Icon, onClick, disabled }) => (
        <button key={key} type="button" onClick={onClick} disabled={disabled} title={title} aria-label={key === 'add' ? 'Add photos to project' : label}
          className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-40">
          <Icon className="h-5 w-5" aria-hidden="true" /><span>{label}</span>
        </button>
      ))}
      <button ref={footerMore} data-focus-fallback type="button" disabled={props.actionsDisabled} aria-expanded={menuOpen} aria-controls="workspace-options" title="More: filters, selection, project and help"
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 aria-expanded:text-white">
        <Ellipsis className="h-5 w-5" aria-hidden="true" /><span>More</span>
      </button>
    </div>
    <nav aria-label="Photo collections" className="flex shrink-0 items-center justify-between gap-2 border-b border-white/8 bg-kestrel-panel px-2 sm:px-4">
      {shoot.inbox ? (
        <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm text-zinc-300">
          Show
          <select aria-label="Filter quick edits" value={filter} disabled={props.actionsDisabled}
            onChange={(event) => props.onFilterChange(event.target.value as FilterState)}
            className="min-h-10 rounded-md border border-white/15 bg-kestrel-panel px-2 text-sm text-zinc-100">
            <option value="all">All photos ({counts.all})</option>
            <option value="unreviewed">Unreviewed ({counts.unreviewed})</option>
            <option value="keep">Kept ({counts.keep})</option>
            <option value="reject">Rejected ({counts.reject})</option>
          </select>
        </label>
      ) : (
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {(['all', 'unreviewed', 'keep', 'reject'] as const).map((collection) => (
            <button key={collection} type="button" aria-current={filter === collection ? 'page' : undefined}
              disabled={props.actionsDisabled} onClick={() => props.onFilterChange(collection)}
              className="flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2 text-sm text-zinc-300 hover:text-white aria-[current=page]:border-sky-200 aria-[current=page]:text-white motion-safe:transition-colors">
              {filterLabels[collection]} <span className="text-xs tabular-nums text-zinc-400">{counts[collection]}</span>
            </button>
          ))}
        </div>
      )}
      <div className="hidden min-w-0 flex-1 items-center justify-end gap-2 md:flex">
        <FilterSortControl searchQuery={searchQuery} onSearchChange={props.onSearchChange}
          ratingFilter={props.ratingFilter} onRatingFilterChange={props.onRatingFilterChange}
          cameraFilter={props.cameraFilter} onCameraFilterChange={props.onCameraFilterChange}
          lensFilter={props.lensFilter} onLensFilterChange={props.onLensFilterChange}
          cameraOptions={props.cameraOptions} lensOptions={props.lensOptions}
          sortOrder={props.sortOrder} onSortOrderChange={props.onSortOrderChange} />
      </div>
    </nav>
    </>
  );
}
