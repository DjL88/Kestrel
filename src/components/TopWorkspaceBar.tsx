import React from 'react';
import {
  Columns2,
  FolderOpen,
  Grid2x2,
  Keyboard,
  Maximize2,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
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
  onOpenShootModal: () => void;
  onOpenMacroPadModal: () => void;
  loadingProgress?: { loaded: number; total: number } | null;
}

export const TopWorkspaceBar: React.FC<TopWorkspaceBarProps> = ({
  shoot,
  counts,
  filter,
  onFilterChange,
  searchQuery,
  onSearchChange,
  keeperTarget,
  onKeeperTargetChange,
  viewMode,
  onViewModeChange,
  showShortcutsOverlay,
  onToggleShortcutsOverlay,
  onOpenShootModal,
  onOpenMacroPadModal,
  loadingProgress,
}) => {
  const filterTabs: { id: FilterState; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'unreviewed', label: 'Unreviewed', count: counts.unreviewed },
    { id: 'keep', label: 'Keep', count: counts.keep },
    { id: 'reject', label: 'Reject', count: counts.reject },
  ];

  const targetMet = counts.keep >= keeperTarget && keeperTarget > 0;

  return (
    <header className="shrink-0 bg-[#14161A] border-b border-white/10 px-4 py-2 flex flex-wrap xl:flex-nowrap items-center justify-between gap-2.5">
      {/* Left Zone: Brand & Shoot Context */}
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-base font-bold tracking-tight text-zinc-100 whitespace-nowrap shrink-0">
          Kestrel
        </span>
        <span className="text-zinc-600 select-none" aria-hidden="true">
          /
        </span>
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-xs font-medium text-zinc-200 truncate max-w-[165px]"
            title={shoot.title}
          >
            {shoot.title}
          </span>
          <span className="text-[11px] text-zinc-400 whitespace-nowrap shrink-0 tabular-nums">
            {shoot.sourceKind === 'demo' ? 'Simulated RAW' : 'Local'}
            <span className="mx-1" aria-hidden="true">
              ·
            </span>
            {counts.all}
          </span>
          {loadingProgress && loadingProgress.loaded < loadingProgress.total && (
            <span className="text-[11px] font-mono text-sky-400 whitespace-nowrap shrink-0 tabular-nums">
              {loadingProgress.loaded}/{loadingProgress.total}
            </span>
          )}
        </div>
      </div>

      {/* Center Zone: Decision Filter + Keeper Target */}
      <div className="flex items-center gap-2 flex-wrap xl:flex-nowrap">
        <div
          role="group"
          aria-label="Filter frames by culling decision"
          className="flex items-center bg-[#0D0E11] p-0.5 rounded-lg border border-white/8"
        >
          {filterTabs.map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onFilterChange(tab.id)}
                aria-pressed={active}
                className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-sky-400 ${
                  active
                    ? 'bg-[#23272F] text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    active ? 'text-zinc-200' : 'text-zinc-500'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Keeper Target Input */}
        <div className="flex items-center gap-1 text-xs text-zinc-300 bg-[#0D0E11] px-2 py-1 rounded-lg border border-white/8 shrink-0">
          <span className="text-zinc-400 whitespace-nowrap">Keepers</span>
          <span
            className={`font-mono font-semibold tabular-nums ${
              targetMet ? 'text-sky-300' : 'text-zinc-100'
            }`}
            data-testid="keeper-progress"
          >
            {counts.keep}
          </span>
          <span className="text-zinc-500">/</span>
          <label htmlFor="keeper-target-input" className="sr-only">
            Keeper target count
          </label>
          <input
            id="keeper-target-input"
            type="number"
            min={1}
            max={9999}
            value={keeperTarget}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10);
              if (!Number.isNaN(parsed) && parsed > 0) {
                onKeeperTargetChange(Math.min(9999, parsed));
              }
            }}
            className="w-10 bg-transparent font-mono text-xs text-zinc-200 tabular-nums text-center border-b border-white/15 focus:border-sky-400 focus:outline-none py-0.5"
          />
        </div>

        {/* Search Input */}
        <div className="relative hidden xl:flex items-center shrink-0">
          <Search
            className="w-3.5 h-3.5 text-zinc-500 absolute left-2 pointer-events-none"
            aria-hidden="true"
          />
          <label htmlFor="frame-search-input" className="sr-only">
            Filter by filename, camera, or lens
          </label>
          <input
            id="frame-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search…"
            className="w-28 2xl:w-40 bg-[#0D0E11] border border-white/8 rounded-lg pl-7 pr-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-sky-400 focus:outline-none"
          />
        </div>
      </div>

      {/* Right Zone: View Modes & Primary Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div
          role="group"
          aria-label="Workspace view mode"
          className="flex items-center bg-[#0D0E11] p-0.5 rounded-lg border border-white/8"
        >
          <button
            type="button"
            onClick={() => onViewModeChange('loupe')}
            aria-pressed={viewMode === 'loupe'}
            className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-sky-400 ${
              viewMode === 'loupe'
                ? 'bg-[#23272F] text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Loupe</span>
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('grid')}
            aria-pressed={viewMode === 'grid'}
            className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-sky-400 ${
              viewMode === 'grid'
                ? 'bg-[#23272F] text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Grid2x2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Grid</span>
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('compare')}
            aria-pressed={viewMode === 'compare'}
            className={`px-2 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-sky-400 ${
              viewMode === 'compare'
                ? 'bg-[#23272F] text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Compare</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenMacroPadModal}
          className="px-2.5 py-1.5 text-xs font-medium text-zinc-200 bg-[#1E2127] hover:bg-[#272B33] border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Macro Pad</span>
        </button>

        <button
          type="button"
          onClick={onToggleShortcutsOverlay}
          aria-pressed={showShortcutsOverlay}
          aria-label="Toggle shortcut overlay"
          title="Toggle shortcut overlay (/)"
          className={`px-2 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-sky-400 ${
            showShortcutsOverlay
              ? 'bg-sky-500/15 text-sky-200 border-sky-400/40'
              : 'bg-[#1E2127] text-zinc-300 border-white/10 hover:bg-[#272B33]'
          }`}
        >
          <Keyboard className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Keys</span>
        </button>

        <button
          type="button"
          onClick={onOpenShootModal}
          className="px-2.5 py-1.5 text-xs font-semibold text-zinc-950 bg-zinc-100 hover:bg-white rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Open Shoot</span>
        </button>
      </div>
    </header>
  );
};
