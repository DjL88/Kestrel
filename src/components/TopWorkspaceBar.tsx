import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, Ellipsis, Plus, Undo2 } from 'lucide-react';
import { messages as m } from '../i18n/messages';
import type { CullCounts, FilterState, ShootDescriptor, WorkspaceViewMode } from '../core/types';

interface TopWorkspaceBarProps {
  shoot: ShootDescriptor;
  counts: CullCounts;
  filter: FilterState;
  onFilterChange: (next: FilterState) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  keeperTarget: number;
  onKeeperTargetChange: (target: number) => void;
  viewMode: WorkspaceViewMode;
  onViewModeChange: (mode: WorkspaceViewMode) => void;
  showShortcutsOverlay: boolean;
  onToggleShortcutsOverlay: () => void;
  onAutoCull: () => void;
  onBackupProject: () => void;
  onBackToProjects: () => void;
  actionsDisabled: boolean;
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
  onExportKeepers?: () => void;
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

const actionClass = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-sky-300';

export function TopWorkspaceBar(props: TopWorkspaceBarProps) {
  const {
    shoot, counts, filter, searchQuery, viewMode, keeperTarget, showShortcutsOverlay,
    loadingProgress, onEditPhoto, showPhotoInfo, autoAdvance,
  } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  function choose(action: () => void, restoreFocus = true) {
    action();
    setMenuOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  return (
    <>
    <header className="relative z-20 flex min-w-0 shrink-0 items-center justify-between gap-2 border-b border-white/8 bg-kestrel-panel px-2 sm:px-4">
      <button type="button" onClick={props.onBackToProjects} disabled={props.actionsDisabled} className={actionClass} aria-label="Back to projects">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">Projects</span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-zinc-100" title={shoot.title}>{shoot.title}</div>
        <div className="truncate text-xs text-zinc-400">
          {loadingProgress ? `Opening ${loadingProgress.loaded}/${loadingProgress.total}` :
            `${shoot.sourceKind === 'demo' ? 'Demo · ' : ''}${counts.keep}/${keeperTarget} keepers${filter === 'all' || filter === 'reject' ? ` · ${filterLabels[filter]}` : ''}${searchQuery ? ' · Search active' : ''}`}
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        <button type="button" onClick={props.onOpenShootModal} disabled={props.actionsDisabled} className={actionClass} aria-label="Add photos to project">
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Add photos</span>
        </button>
        <button type="button" onClick={onEditPhoto} disabled={!onEditPhoto || props.actionsDisabled} className={`${actionClass} text-sky-200 disabled:opacity-40`}>Edit</button>
        <div ref={menuRef}>
          <button ref={triggerRef} type="button" disabled={props.actionsDisabled} className={actionClass} onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Workspace options" aria-expanded={menuOpen} aria-controls="workspace-options">
            <Ellipsis className="h-5 w-5" aria-hidden="true" />
          </button>
          {menuOpen && (
            <div id="workspace-options" data-workspace-options className="workspace-popover absolute right-2 top-full mt-1 max-h-[calc(100dvh_-_4rem)] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-white/12 bg-kestrel-raised p-3 shadow-2xl sm:right-4">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-zinc-400">
                  Search photos
                  <input type="search" value={searchQuery} onChange={(event) => props.onSearchChange(event.target.value)}
                    placeholder="Subject name or filename"
                    className="mt-1 min-h-10 w-full rounded-md border border-white/10 bg-black/20 px-2 text-base text-zinc-100 sm:text-sm" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="relative text-xs font-medium text-zinc-400">
                    Show
                    <select aria-label="Show photos" value={filter} onChange={(event) => choose(() => props.onFilterChange(event.target.value as FilterState))}
                      className="mt-1 min-h-10 w-full appearance-none rounded-md border border-white/10 bg-kestrel-panel px-2 pr-6 text-sm text-zinc-100">
                      {Object.entries(filterLabels).map(([id, label]) => <option key={id} value={id}>{label} ({counts[id as FilterState]})</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 bottom-3 h-4 w-4" aria-hidden="true" />
                  </label>
                  <label className="relative text-xs font-medium text-zinc-400">
                    View
                    <select aria-label="View" value={viewMode} onChange={(event) => choose(() => props.onViewModeChange(event.target.value as WorkspaceViewMode))}
                      className="mt-1 min-h-10 w-full appearance-none rounded-md border border-white/10 bg-kestrel-panel px-2 pr-6 text-sm text-zinc-100">
                      {Object.entries(viewLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 bottom-3 h-4 w-4" aria-hidden="true" />
                  </label>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-1 border-t border-white/10 pt-2">
                <button type="button" className={actionClass} aria-pressed={showPhotoInfo} onClick={() => choose(props.onTogglePhotoInfo)}>{showPhotoInfo ? 'Hide photo info' : 'Photo info'}</button>
                <button type="button" className={actionClass} onClick={() => choose(props.onOpenMacroPadModal, false)}>Macro pad</button>
                <button type="button" className={actionClass} onClick={() => choose(props.onBackupProject)}>Back up project</button>
                <button type="button" className={actionClass} onClick={() => choose(props.onAutoCull, false)}>{m.autoCull}</button>
                {props.onToggleMultiSelect && <button type="button" className={actionClass} onClick={() => choose(() => props.onToggleMultiSelect?.())}>
                  {props.multiSelect ? 'Done selecting' : 'Select photos'}
                </button>}
                {props.onClearDecision && <button type="button" className={actionClass} onClick={() => choose(() => props.onClearDecision?.())}>Clear decision</button>}
                {props.onRedo && <button type="button" className={actionClass} onClick={() => choose(() => props.onRedo?.())}>Redo decision</button>}
              </div>
              <details className="mt-2 border-t border-white/10 pt-2">
                <summary className="min-h-10 cursor-pointer py-2 text-sm text-zinc-300">Layout</summary>
                <label className="flex min-h-9 items-center gap-2 px-1 pb-2 text-sm">
                  <input type="checkbox" checked={props.showFilmstrip} onChange={props.onToggleFilmstrip} />
                  Pin filmstrip
                </label>
                <label className="flex min-h-9 items-center gap-2 px-1 pb-2 text-sm">
                  <input type="checkbox" checked={props.focusMode} onChange={props.onToggleFocusMode} />
                  Focus mode
                </label>
              </details>
              <details className="mt-2 border-t border-white/10 pt-2">
                <summary className="min-h-10 cursor-pointer py-2 text-sm text-zinc-300">Culling settings</summary>
                <div className="space-y-2 px-1 pb-2 text-sm">
                  <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={autoAdvance} onChange={props.onToggleAutoAdvance} />Auto-advance</label>
                  <label className="flex min-h-9 items-center gap-2"><input type="checkbox" checked={showShortcutsOverlay} onChange={props.onToggleShortcutsOverlay} />Show shortcut guide</label>
                  <label className="flex items-center justify-between gap-2">
                    Keeper target
                    <input type="number" min={1} max={9999} value={keeperTarget}
                      onChange={(event) => {
                        const next = event.target.valueAsNumber;
                        if (Number.isInteger(next) && next >= 1 && next <= 9999) props.onKeeperTargetChange(next);
                      }}
                      className="min-h-9 w-20 rounded-md border border-white/10 bg-black/20 px-2 text-right" />
                  </label>
                </div>
              </details>
            </div>
          )}
        </div>
      </div>
    </header>
    <nav aria-label="Photo collections" className="flex shrink-0 items-center justify-between gap-2 border-b border-white/8 bg-kestrel-panel px-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {(['unreviewed', 'keep', 'reject'] as const).map((collection) => (
          <button key={collection} type="button" aria-current={filter === collection ? 'page' : undefined}
            disabled={props.actionsDisabled} onClick={() => props.onFilterChange(collection)}
            className="flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2 text-sm text-zinc-300 hover:text-white aria-[current=page]:border-sky-200 aria-[current=page]:text-white motion-safe:transition-colors">
            {filterLabels[collection]} <span className="text-xs tabular-nums text-zinc-400">{counts[collection]}</span>
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center">
      {props.onExportKeepers && <button type="button" disabled={props.actionsDisabled} className={`${actionClass} text-sky-200`}
        onClick={props.onExportKeepers} aria-label="Export keepers"><span className="sm:hidden">Export</span><span className="hidden sm:inline">Export keepers</span></button>}
      <button type="button" disabled={!props.onUndo || props.actionsDisabled}
        onClick={props.onUndo} aria-label="Undo last flag"
        className={`${actionClass} text-zinc-300 disabled:opacity-35`}>
        <Undo2 className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">Undo</span>
      </button>
      </div>
    </nav>
    </>
  );
}
