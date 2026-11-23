import React, { useEffect, useState } from 'react';
import type { AssistMode, DockPosition, PanelId, PanelLayoutState } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon, { type BrandIconName, assistModeIconName } from '../icons/BrandIcon';

interface RailProps {
  assistMode: AssistMode;
  activePanel: PanelId | null;
  panels: Record<PanelId, PanelLayoutState>;
  runningTaskCount: number;
  /** Average progress of running tasks, 0 to 100. */
  taskProgress: number;
  onOpenTasks: () => void;
  onOpenModeSettings: () => void;
  calmView: boolean;
  onSelectPanel: (panelId: PanelId) => void;
  onSetPanelVisible: (panelId: PanelId, visible: boolean) => void;
  onSetPanelDock: (panelId: PanelId, dock: DockPosition) => void;
  onOpenSettings: () => void;
  /** Show every photo of the project at once. Sits at the foot of the tools, above Tasks. */
  onOpenAllPhotos?: () => void;
  allPhotosOpen?: boolean;
  /** Tools that are not offered on this plan are left out of the rail altogether. */
  hiddenPanels?: PanelId[];
  /** 'left' puts the rail on the right (left-handed mode). */
  hand?: 'right' | 'left';
}

interface RailItem {
  id: PanelId;
  label: string;
  icon: BrandIconName;
}

export default function Rail({
  assistMode,
  activePanel,
  panels,
  runningTaskCount,
  taskProgress,
  onOpenTasks,
  onOpenModeSettings,
  calmView,
  onSelectPanel,
  onSetPanelVisible,
  onSetPanelDock,
  onOpenSettings,
  onOpenAllPhotos,
  allPhotosOpen = false,
  hiddenPanels = [],
  hand = 'right',
}: RailProps) {
  const [contextPos, setContextPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!contextPos) return;
    const close = () => setContextPos(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextPos(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextPos]);

  // Co-pilot rail button dynamically reflects the active mode from TopBar
  const modeLabel =
    assistMode === 'solo'
      ? STRINGS.rail.solo
      : assistMode === 'autopilot'
      ? STRINGS.rail.autopilot
      : STRINGS.rail.copilot;

  const allItems: RailItem[] = [
    { id: 'copilot', label: modeLabel, icon: assistModeIconName(assistMode) },
    { id: 'adjust', label: STRINGS.rail.adjust, icon: 'sliders' },
    { id: 'formats', label: STRINGS.rail.formats, icon: 'all-sizes' },
    { id: 'masks', label: STRINGS.rail.masks, icon: 'masks' },
    { id: 'enhance', label: STRINGS.rail.enhance, icon: 'focus' },
    { id: 'overlays', label: STRINGS.rail.overlays, icon: 'overlay' },
    { id: 'history', label: STRINGS.rail.history, icon: 'undo' },
    { id: 'info', label: STRINGS.rail.info, icon: 'info' },
  ];

  const items = allItems.filter((item) => !hiddenPanels.includes(item.id));
  // A tool the person hid is taken off the rail (not greyed). It stays in the Panels & layout menu, which lists `items`, so it can be shown again.
  const railItems = items.filter((item) => panels[item.id]?.visible !== false);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 280);
    const y = Math.min(e.clientY, window.innerHeight - 360);
    setContextPos({ x: Math.max(8, x), y: Math.max(8, y) });
  };

  return (
    <>
      <aside
        aria-label="Studio tools"
        onContextMenu={handleContextMenu}
        className={`hidden md:flex w-[var(--rail-width)] shrink-0 flex-col items-center justify-between ${hand === 'left' ? 'border-l' : 'border-r'} border-[var(--border-subtle)] bg-[var(--bg-surface)] py-2 select-none`}
      >
        <div className="flex w-full flex-col items-center gap-0.5 overflow-y-auto inflight-scroll px-1.5">
          {railItems.map((item) => {
            const isActive = activePanel === item.id;
            const isHidden = !panels[item.id]?.visible;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={isActive}
                title={`${item.label} (Right-click rail to dock or float)`}
                onClick={() => onSelectPanel(item.id)}
                className={`relative flex w-full flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] py-2 px-1 text-[10px] font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                    : isHidden
                    ? 'text-[var(--text-muted)] opacity-55 hover:bg-[var(--bg-surface-hover)] hover:opacity-100'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                <BrandIcon name={item.icon} size={18} />
                <span className="truncate max-w-full leading-tight">{item.label}</span>
                {false && runningTaskCount > 0 && !calmView && (
                  <span
                    aria-label={`${runningTaskCount} running tasks`}
                    className="absolute right-1.5 top-1.5 min-w-[16px] rounded-full bg-[var(--brand-accent)] px-1 text-center text-[9px] font-bold text-[var(--text-on-accent)] tabular-nums"
                  >
                    {runningTaskCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="w-full space-y-0.5 border-t border-[var(--border-subtle)] px-1.5 pt-2">
          {onOpenAllPhotos && (
            <button
              type="button"
              onClick={onOpenAllPhotos}
              aria-pressed={allPhotosOpen}
              title="Show all photos at once"
              aria-label="All photos"
              data-testid="all-photos-button"
              className={`flex w-full flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] py-2 text-[10px] font-medium transition-colors ${
                allPhotosOpen ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              <BrandIcon name="image" size={18} />
              <span>All photos</span>
            </button>
          )}
          <TasksWheel running={runningTaskCount} percent={taskProgress} active={activePanel === 'tasks'} onClick={onOpenTasks} />
          <button
            type="button"
            onClick={onOpenModeSettings}
            title={STRINGS.modeFlag.label(modeLabel)}
            aria-label={STRINGS.modeFlag.label(modeLabel)}
            data-testid="mode-flag"
            className="flex w-full flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] border border-[var(--brand-accent-border)] bg-[var(--brand-accent-soft)] py-1.5 text-[10px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface-hover)]"
          >
            <BrandIcon name={assistModeIconName(assistMode)} size={16} className="text-[var(--brand-accent)]" />
            <span className="truncate leading-tight">{modeLabel}</span>
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={STRINGS.rail.settings}
            className="flex w-full flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] py-2 text-[10px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <BrandIcon name="settings" size={18} />
            <span>{STRINGS.rail.settings}</span>
          </button>
        </div>
      </aside>

      {/* Right-click Rail Context Menu: Show/Hide + Dock Left/Right/Float */}
      {contextPos && (
        <div
          role="menu"
          aria-label={STRINGS.rail.contextMenuTitle}
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-50 w-64 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-2 shadow-[var(--shadow-popover)]"
          style={{ left: contextPos.x, top: contextPos.y }}
        >
          <p className="px-2 pb-1.5 text-[11px] font-semibold text-[var(--text-secondary)]">
            {STRINGS.rail.contextMenuTitle}
          </p>
          <div className="space-y-0.5">
            {items.map((item) => {
              const state = panels[item.id];
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-1 rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-[var(--bg-surface-hover)]"
                >
                  <button
                    type="button"
                    onClick={() => onSetPanelVisible(item.id, !state.visible)}
                    className="flex items-center gap-2 text-xs text-[var(--text-primary)]"
                  >
                    <BrandIcon
                      name={state.visible ? 'checkbox-checked' : 'checkbox-empty'}
                      size={14}
                      className={state.visible ? 'text-[var(--brand-accent)]' : 'text-[var(--text-muted)]'}
                    />
                    <span>{item.label}</span>
                  </button>
                  <div className="flex items-center gap-0.5">
                    {(['left', 'right', 'float'] as DockPosition[]).map((dock) => (
                      <button
                        key={dock}
                        type="button"
                        onClick={() => {
                          onSetPanelDock(item.id, dock);
                          setContextPos(null);
                        }}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize transition-colors ${
                          state.dock === dock
                            ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                            : 'text-[var(--text-muted)] hover:bg-[var(--bg-surface-active)] hover:text-[var(--text-primary)]'
                        }`}
                      >
                        {dock}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

/** Tasks, as a count inside a progress ring. The ring is a second cue: the number and the words say the same thing. */
function TasksWheel({ running, percent, active, onClick }: { running: number; percent: number; active: boolean; onClick: () => void }) {
  const radius = 11, circumference = 2 * Math.PI * radius;
  const shown = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={STRINGS.tasks.wheel(running, shown)}
      title={STRINGS.tasks.wheel(running, shown)}
      data-testid="tasks-wheel"
      className={`flex w-full flex-col items-center justify-center gap-1 rounded-[var(--radius-md)] py-1.5 text-[10px] font-medium transition-colors ${
        active ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
      }`}
    >
      <span className="relative grid h-7 w-7 place-items-center">
        <svg viewBox="0 0 28 28" className="absolute inset-0 h-7 w-7 -rotate-90" aria-hidden="true">
          <circle cx="14" cy="14" r={radius} fill="none" stroke="var(--border-default)" strokeWidth="2.5" />
          {running > 0 && (
            <circle cx="14" cy="14" r={radius} fill="none" stroke="var(--brand-accent)" strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray={circumference} strokeDashoffset={circumference * (1 - shown / 100)} />
          )}
        </svg>
        <span className="relative text-[11px] font-bold tabular-nums text-[var(--text-primary)]">{running}</span>
      </span>
      <span>{STRINGS.rail.tasks}</span>
    </button>
  );
}
