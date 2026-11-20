import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArchiveRestore, ArrowLeft, Columns2, Download, Ellipsis, Grid3X3, Image as ImageIcon, Eraser, FileDown, FolderInput, Keyboard, ListChecks, Pencil, Plus, Redo2, Save, ScanSearch, Trash2, Undo2 } from 'lucide-react';
import type { ProjectSettings } from '../core/projectSettings';
import { isDesktopApp } from '../providers/desktopShell';
import { messages as m } from '../i18n/messages';
import type { CullCounts, FilterState, RatingFilter, ShootDescriptor, SortOrder, WorkspaceViewMode } from '../core/types';
import { FilterSortControl } from './FilterSortControl';
import { libraryText as t } from '../i18n/areas/library';

interface TopWorkspaceBarProps {
  /** Work in hand (Tasks), shown compactly in this row rather than in rows of its own. */
  status?: ReactNode;
  /** The Settings button, in the far right corner as on every page. */
  settingsButton?: ReactNode;
  /** Open the single shared Settings dialog from this workspace. */
  onOpenSettings?: () => void;
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
  /** Contextual action when editing a marked selection, not just the active photo. */
  editLabel?: string;
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
  /** Export ratings, decisions and confirmed tags as separate XMP files. */
  onSaveSidecars?: () => void;
  /** Import only matching sidecars for explicitly selected originals. */
  onImportSidecars?: (files: File[]) => void;
  exportLabel?: string;
  /** How many photos Export would export, for the number-only label on small screens (shown only when more than one). */
  exportCount?: number;
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
  /** Section F: both workspace panes fold into thin docked icon rails. */
  panesCollapsed?: boolean;
  onTogglePanes?: () => void;
  onRedo?: () => void;
  loadingProgress?: { loaded: number; total: number } | null;
}

const filterLabels: Record<FilterState, string> = {
  all: m.allPhotos, unreviewed: m.review, keep: m.keepers, reject: m.trash,
};

const viewLabels: Record<WorkspaceViewMode, string> = {
  loupe: t.top.viewSingle, grid: t.top.viewGrid, compare: t.top.viewCompare,
};

function MenuSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-white/10 pt-2">
      <h3 id={id} className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h3>
      <div className="grid grid-cols-2 gap-1">{children}</div>
    </section>
  );
}

function MenuItem({ icon, children, onClick, disabled, pressed, wide, title }: {
  icon: React.ReactNode; children: React.ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean; wide?: boolean; title?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={pressed} title={title}
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
  const xmpPicker = useRef<HTMLInputElement>(null);
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
    <header className="relative z-50 flex min-w-0 shrink-0 items-center justify-between gap-3 py-1.5 border-b border-white/8 bg-kestrel-panel px-2 sm:px-4">
      <input ref={xmpPicker} type="file" hidden multiple accept=".xmp,.zip,application/rdf+xml,application/zip"
        data-testid="file-menu-xmp-import" onChange={event => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (files.length) props.onImportSidecars?.(files);
        }} />
      <button type="button" onClick={props.onBackToProjects} disabled={props.actionsDisabled} className={actionClass} aria-label={t.top.backToProjects} title={t.top.backToProjects}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{t.top.projects}</span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-zinc-100" title={shoot.title}>{shoot.title}</div>
        <div className="truncate text-xs text-zinc-400">
          {shoot.inbox ? `${t.top.photoCount(counts.all)}${searchQuery ? ` · ${t.top.searchActive}` : ''}${props.ratingFilter || props.cameraFilter || props.lensFilter ? ` · ${t.top.filtersActive}` : ''}` : `${shoot.sourceKind === 'demo' ? `${t.top.demo} · ` : ''}${t.top.keepersOfTarget(counts.keep, keeperTarget)}${filter === 'all' || filter === 'reject' ? ` · ${filterLabels[filter]}` : ''}${searchQuery ? ` · ${t.top.searchActive}` : ''}${props.ratingFilter || props.cameraFilter || props.lensFilter ? ` · ${t.top.filtersActive}` : ''}`}
        </div>
      </div>
      <div className="flex min-w-0 shrink items-center gap-2">
        {props.status}
        <button type="button" onClick={props.onOpenShootModal} disabled={props.actionsDisabled || props.addDisabled} className={`${actionClass} border border-white/15 max-md:hidden`} aria-label={t.top.addPhotosToProject} title={t.top.addPhotos}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{t.top.add}</span>
        </button>
        <button type="button" onClick={onEditPhoto} disabled={!onEditPhoto || props.actionsDisabled} aria-label={props.editLabel ?? t.top.edit} title={props.editLabel ?? t.top.editTitle}
          className={`${actionClass} border border-sky-300/50 text-sky-100 hover:bg-sky-300/15 disabled:opacity-40 max-md:hidden`}>
          <Pencil className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{props.editLabel ?? t.top.edit}</span>
        </button>
        <button type="button" onClick={props.onExport} disabled={!props.onExport || props.actionsDisabled} aria-label={props.exportLabel ?? t.top.export} title={t.top.exportTitle}
          className={`${actionClass} bg-kestrel-copper font-semibold text-zinc-950 hover:bg-kestrel-copper-hover! disabled:opacity-40 max-md:hidden`}>
          <Download className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">{props.exportLabel ?? t.top.export}</span>
          <span className="tabular-nums sm:hidden" aria-hidden="true">{props.exportCount !== undefined
            ? (props.exportCount > 1 ? t.top.exportCountShort(props.exportCount) : '')
            : props.exportLabel?.replace(t.top.export, '').trim()}</span>
        </button>
        <div ref={menuRef}>
          <button ref={triggerRef} data-focus-fallback type="button" disabled={props.actionsDisabled} className={`${actionClass} border border-white/15 max-md:hidden`} onClick={() => setMenuOpen(!menuOpen)}
            aria-label={t.top.workspaceOptions} title={t.top.workspaceOptions} aria-expanded={menuOpen} aria-controls="workspace-options">
            <Ellipsis className="h-5 w-5" aria-hidden="true" />
          </button>
          {menuOpen && (
            <div id="workspace-options" data-workspace-options className="workspace-popover fixed inset-x-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 max-h-[70dvh] md:absolute md:inset-x-auto md:bottom-auto md:right-2 md:top-full md:mt-1 md:max-h-[calc(100dvh-8rem)] md:w-[min(26rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border border-white/12 bg-kestrel-raised p-3 shadow-2xl sm:right-4">
              <div className="space-y-3">
                <section aria-label={t.top.findPhotos} className="md:hidden">
                  <FilterSortControl searchQuery={searchQuery} onSearchChange={props.onSearchChange}
                    ratingFilter={props.ratingFilter} onRatingFilterChange={props.onRatingFilterChange}
                    cameraFilter={props.cameraFilter} onCameraFilterChange={props.onCameraFilterChange}
                    lensFilter={props.lensFilter} onLensFilterChange={props.onLensFilterChange}
                    cameraOptions={props.cameraOptions} lensOptions={props.lensOptions}
                    sortOrder={props.sortOrder} onSortOrderChange={props.onSortOrderChange}
                    className="flex-wrap" />
                </section>

                <section aria-labelledby="menu-view" className="grid grid-cols-2 gap-2">
                  <h3 id="menu-view" className="sr-only">{t.top.view}</h3>
                  <label className="text-xs font-medium text-zinc-400">
                    {t.top.show}
                    <select aria-label={t.top.showPhotos} value={filter} onChange={(event) => choose(() => props.onFilterChange(event.target.value as FilterState))}
                      className="mt-1 min-h-10 w-full rounded-md border border-white/10 bg-kestrel-panel ps-2 text-sm text-zinc-100">
                      {Object.entries(filterLabels).map(([id, label]) => <option key={id} value={id}>{label} ({counts[id as FilterState]})</option>)}
                    </select>
                  </label>
                  <label className="text-xs font-medium text-zinc-400">
                    {t.top.view}
                    <select aria-label={t.top.view} value={viewMode} onChange={(event) => choose(() => props.onViewModeChange(event.target.value as WorkspaceViewMode))}
                      className="mt-1 min-h-10 w-full rounded-md border border-white/10 bg-kestrel-panel ps-2 text-sm text-zinc-100">
                      {Object.entries(viewLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                  </label>
                </section>

                <MenuSection id="menu-file" title={t.top.file}>
                  <MenuItem wide icon={<Plus className="h-4 w-4" aria-hidden="true" />} disabled={props.actionsDisabled || props.addDisabled} onClick={() => choose(props.onOpenShootModal, false)}>{t.top.addPhotos}…</MenuItem>
                  <MenuItem wide icon={<Download className="h-4 w-4" aria-hidden="true" />} disabled={!props.onExport} onClick={() => choose(() => props.onExport?.(), false)}>{t.top.exportTitle}…</MenuItem>
                  <MenuItem wide icon={<FileDown className="h-4 w-4" aria-hidden="true" />} title={t.top.xmpHelp}
                    disabled={!props.onSaveSidecars} onClick={() => choose(() => props.onSaveSidecars?.(), false)}>{t.top.xmpSidecars}</MenuItem>
                  <MenuItem wide icon={<FolderInput className="h-4 w-4" aria-hidden="true" />} title={t.top.xmpImportHelp}
                    disabled={!props.onImportSidecars} onClick={() => choose(() => xmpPicker.current?.click(), false)}>{t.top.xmpImport}</MenuItem>
                </MenuSection>
                <MenuSection id="menu-edit-photo" title={t.top.edit}>
                  <MenuItem wide icon={<Pencil className="h-4 w-4" aria-hidden="true" />} disabled={!onEditPhoto} onClick={() => choose(() => onEditPhoto?.(), false)}>{t.top.edit}</MenuItem>
                  <MenuItem wide icon={<Pencil className="h-4 w-4" aria-hidden="true" />} disabled={!props.onAutoAdjustKeepers} onClick={() => choose(() => props.onAutoAdjustKeepers?.(), false)}>{t.top.autoAdjust}</MenuItem>
                  <MenuItem wide icon={<Pencil className="h-4 w-4" aria-hidden="true" />} disabled={!props.onBatchLook} onClick={() => choose(() => props.onBatchLook?.(), false)}>{t.top.applyRecipe}</MenuItem>
                </MenuSection>
                <details className="border-t border-white/10 pt-1">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-zinc-200">{t.top.viewLayout}</summary>
                  <button type="button" onClick={() => choose(() => window.dispatchEvent(new Event('kestrel:toggle-burst-group')))}
                    className="flex min-h-10 w-full items-center rounded-md px-2 text-left text-sm text-zinc-100 hover:bg-white/10">
                    {t.top.groupBursts}
                  </button>
                  <label className="flex min-h-9 items-center gap-2 px-1 pb-2 text-sm">
                    <input type="checkbox" checked={props.showFilmstrip} onChange={props.onToggleFilmstrip} />
                    {t.top.showFilmstrip}
                  </label>
                  <label className="flex min-h-9 items-center gap-2 px-1 pb-2 text-sm">
                    <input type="checkbox" checked={showPhotoInfo} onChange={props.onTogglePhotoInfo} />
                    {t.top.photoInfo}
                  </label>
                  {props.onTogglePanes && <label className="flex min-h-9 items-center gap-2 px-1 pb-2 text-sm">
                    <input type="checkbox" checked={props.panesCollapsed ?? false} onChange={props.onTogglePanes} />
                    {t.top.foldPanes}
                  </label>}
                  <label className="flex min-h-9 items-center gap-2 px-1 pb-2 text-sm">
                    <input type="checkbox" checked={props.focusMode} onChange={props.onToggleFocusMode} />
                    {t.top.photoOnly}
                  </label>
                  <label className="flex min-h-9 items-center gap-2 px-1 pb-2 text-sm">
                    <input type="checkbox" checked={showShortcutsOverlay} onChange={props.onToggleShortcutsOverlay} />
                    {t.top.showShortcutGuide}
                  </label>
                  {props.onHandChange && <div role="group" aria-label={t.top.panelPosition} className="mb-2 flex flex-wrap items-center gap-2 text-sm text-zinc-200">
                    <span>{t.top.panels}</span>
                    <button type="button" aria-pressed={props.hand === 'left'} onClick={() => props.onHandChange?.('left')} className="rounded-md border border-white/15 px-3 py-2 aria-pressed:bg-sky-300/20">{t.top.left}</button>
                    <button type="button" aria-pressed={props.hand !== 'left'} onClick={() => props.onHandChange?.('right')} className="rounded-md border border-white/15 px-3 py-2 aria-pressed:bg-sky-300/20">{t.top.right}</button>
                  </div>}
                  {props.onOpenSettings && <button type="button" onClick={() => choose(props.onOpenSettings!)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-md border border-white/15 px-3 text-left text-sm text-zinc-100 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300">
                    {m.settings.title}
                  </button>}
                  {isDesktopApp() && <button type="button" onClick={() => choose(props.onOpenMacroPadModal, false)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-zinc-200 hover:bg-white/10">
                    <Keyboard className="h-4 w-4" aria-hidden="true" />{t.top.macroPad}
                  </button>}
                </details>
                <MenuSection id="menu-history" title={t.top.undoAndRedo}>
                  <MenuItem wide icon={<Undo2 className="h-4 w-4" aria-hidden="true" />} disabled={!props.onUndo}
                    onClick={() => choose(() => props.onUndo?.())}>{props.undoLabel ? t.top.undoAction(props.undoLabel) : t.top.nothingToUndo}</MenuItem>
                  <MenuItem wide icon={<Redo2 className="h-4 w-4" aria-hidden="true" />} disabled={!props.onRedo}
                    onClick={() => choose(() => props.onRedo?.())}>{props.redoLabel ? t.top.redoAction(props.redoLabel) : t.top.nothingToRedo}</MenuItem>
                </MenuSection>

                <MenuSection id="menu-selection" title={t.top.photos}>
                  {props.onToggleMultiSelect && <MenuItem icon={<ListChecks className="h-4 w-4" aria-hidden="true" />} onClick={() => choose(() => props.onToggleMultiSelect?.())}>
                    {props.multiSelect ? t.top.doneSelecting : t.top.selectPhotos}</MenuItem>}
                  <MenuItem icon={<Eraser className="h-4 w-4" aria-hidden="true" />} disabled={!props.onClearDecision} onClick={() => choose(() => props.onClearDecision?.())}>{t.top.clearDecision}</MenuItem>
                  <MenuItem icon={<FolderInput className="h-4 w-4" aria-hidden="true" />} disabled={!props.onMoveToProject} onClick={() => choose(() => props.onMoveToProject?.(), false)}>{t.top.moveToProject}</MenuItem>
                  <MenuItem icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} disabled={!props.onRemoveFromLibrary} onClick={() => choose(() => props.onRemoveFromLibrary?.(), false)}>{t.top.removeFromLibrary}</MenuItem>
                  <MenuItem icon={<ArchiveRestore className="h-4 w-4" aria-hidden="true" />} disabled={!props.onOpenRemoved} onClick={() => choose(() => props.onOpenRemoved?.(), false)}>{t.top.removedPhotos(props.removedCount ?? 0)}</MenuItem>
                </MenuSection>


                <MenuSection id="menu-project" title={shoot.inbox ? t.top.quickEdits : t.top.project}>
                  {!shoot.inbox && <MenuItem icon={<ScanSearch className="h-4 w-4" aria-hidden="true" />} onClick={() => choose(props.onAutoCull, false)}>{m.autoCull}</MenuItem>}
                  <MenuItem icon={<Pencil className="h-4 w-4" aria-hidden="true" />} disabled={!props.onBatchLook} onClick={() => choose(() => props.onBatchLook?.(), false)}>{t.top.applyRecipe}</MenuItem>
                  <MenuItem icon={<Pencil className="h-4 w-4" aria-hidden="true" />} disabled={!props.onAutoAdjustKeepers} onClick={() => choose(() => props.onAutoAdjustKeepers?.(), false)}>{t.top.autoAdjust}</MenuItem>
                  <MenuItem icon={<FileDown className="h-4 w-4" aria-hidden="true" />} disabled={!props.onExportKeepers} onClick={() => choose(() => props.onExportKeepers?.())}>{t.top.exportKeepers}</MenuItem>
                  {!shoot.inbox && <MenuItem icon={<Save className="h-4 w-4" aria-hidden="true" />} onClick={() => choose(props.onBackupProject)}>{t.top.backUpProject}</MenuItem>}
                  {props.onWatchFolder && <MenuItem icon={<FolderInput className="h-4 w-4" aria-hidden="true" />} onClick={() => choose(props.onWatchFolder!, props.watching ? true : false)}>{props.watching ? t.top.stopWatching(props.watching) : t.top.watchFolder}</MenuItem>}
                  {props.onLocations && <MenuItem icon={<FolderInput className="h-4 w-4" aria-hidden="true" />} onClick={() => choose(props.onLocations!, false)}>{t.top.whereKept}</MenuItem>}
                  {props.onSyncFolder && <MenuItem icon={<FolderInput className="h-4 w-4" aria-hidden="true" />} onClick={() => choose(props.onSyncFolder!, false)}>{t.top.syncFolder}</MenuItem>}
                </MenuSection>

                <details className="border-t border-white/10 pt-1">
                  <summary className="min-h-10 cursor-pointer py-2 text-sm text-zinc-300">{t.top.cullingSettings}</summary>
                  <div className="space-y-2 px-1 pb-2 text-sm">
                    <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={autoAdvance} onChange={props.onToggleAutoAdvance} />{t.top.autoAdvance}</label>
                    {props.settings && props.onSettingsChange && <>
                      <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={props.settings.autoCull}
                        onChange={(event) => props.onSettingsChange?.({ ...props.settings!, autoCull: event.target.checked })} />{t.top.autoCullAfterAdding}</label>
                      <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={props.settings.autoEdit}
                        onChange={(event) => props.onSettingsChange?.({ ...props.settings!, autoEdit: event.target.checked })} />{t.top.autoEditOnOpen}</label>
                    </>}
                    {!shoot.inbox && <label className="flex items-center justify-between gap-2">
                      {t.top.keeperTarget}
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
        {props.settingsButton}
      </div>
    </header>
    <div role="toolbar" aria-label={t.top.photoActions} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-white/10 bg-kestrel-panel pb-[env(safe-area-inset-bottom)] md:hidden">
      {([
        { key: 'add', label: t.top.add, title: t.top.addPhotos, Icon: Plus, onClick: props.onOpenShootModal, disabled: props.actionsDisabled || props.addDisabled },
        { key: 'edit', label: props.editLabel ?? t.top.edit, title: props.editLabel ?? t.top.editTitle, Icon: Pencil, onClick: onEditPhoto, disabled: !onEditPhoto || props.actionsDisabled },
        { key: 'export', label: props.exportLabel ?? t.top.export, title: t.top.exportTitle, Icon: Download, onClick: props.onExport, disabled: !props.onExport || props.actionsDisabled },
      ] as const).map(({ key, label, title, Icon, onClick, disabled }) => (
        <button key={key} type="button" onClick={onClick} disabled={disabled} title={title} aria-label={key === 'add' ? t.top.addPhotosToProject : label}
          className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-40">
          <Icon className="h-5 w-5" aria-hidden="true" /><span>{label}</span>
        </button>
      ))}
      <button ref={footerMore} data-focus-fallback type="button" disabled={props.actionsDisabled} aria-expanded={menuOpen} aria-controls="workspace-options" title={t.top.moreTitle}
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-zinc-200 hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 aria-expanded:text-white">
        <Ellipsis className="h-5 w-5" aria-hidden="true" /><span>{t.top.more}</span>
      </button>
    </div>
    <nav aria-label={t.top.photoCollections} className="relative z-50 flex shrink-0 items-center justify-between gap-2 border-b border-white/8 bg-kestrel-panel px-2 sm:px-4">
      {shoot.inbox ? (
        <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm text-zinc-300">
          {t.top.show}
          <select aria-label={t.top.filterQuickEdits} value={filter} disabled={props.actionsDisabled}
            onChange={(event) => props.onFilterChange(event.target.value as FilterState)}
            className="min-h-10 rounded-md border border-white/15 bg-kestrel-panel px-2 text-sm text-zinc-100">
            <option value="all">{t.top.allPhotos} ({counts.all})</option>
            <option value="unreviewed">{t.top.unreviewed} ({counts.unreviewed})</option>
            <option value="keep">{t.top.kept} ({counts.keep})</option>
            <option value="reject">{t.top.rejected} ({counts.reject})</option>
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
        {/* The grid's Jump control is placed here (see VirtualizedContactSheet), in the bar rather than over a photo. */}
        {/* Views as buttons, not hidden in a menu: grid, single photo, compare. Words as well as icons. */}
        <div role="group" aria-label={t.top.view} className="flex shrink-0 items-center rounded-md border border-white/15 p-0.5">
          {([['grid', Grid3X3], ['loupe', ImageIcon], ['compare', Columns2]] as const).map(([mode, Icon]) => (
            <button key={mode} type="button" aria-label={viewLabels[mode]} aria-pressed={viewMode === mode} onClick={() => props.onViewModeChange(mode)}
              title={mode === 'grid' ? t.top.gridTitle : mode === 'loupe' ? t.top.singleTitle : t.top.compareTitle}
              className="inline-flex min-h-10 items-center gap-1.5 rounded px-2.5 text-sm text-zinc-300 hover:bg-white/8 aria-pressed:bg-white/15 aria-pressed:text-white focus-visible:outline-2 focus-visible:outline-sky-300">
              <Icon className="h-4 w-4" aria-hidden="true" /><span className="hidden lg:inline">{viewLabels[mode]}</span>
            </button>
          ))}
        </div>
        <div id="kestrel-grid-tools" className="relative flex items-center" />
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
