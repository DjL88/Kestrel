import React, { useEffect, useState } from 'react';
import type { AssistMode, DockPosition, PanelId, PanelLayoutState } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon, { type BrandIconName, assistModeIconName } from '../icons/BrandIcon';

interface RailProps {
  assistMode: AssistMode;
  activePanel: PanelId | null;
  panels: Record<PanelId, PanelLayoutState>;
  runningTaskCount: number;
  calmView: boolean;
  onSelectPanel: (panelId: PanelId) => void;
  onSetPanelVisible: (panelId: PanelId, visible: boolean) => void;
  onSetPanelDock: (panelId: PanelId, dock: DockPosition) => void;
  onOpenSettings: () => void;
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
  calmView,
  onSelectPanel,
  onSetPanelVisible,
  onSetPanelDock,
  onOpenSettings,
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

  const items: RailItem[] = [
    { id: 'copilot', label: modeLabel, icon: assistModeIconName(assistMode) },
    { id: 'adjust', label: STRINGS.rail.adjust, icon: 'sliders' },
    { id: 'formats', label: STRINGS.rail.formats, icon: 'all-sizes' },
    { id: 'masks', label: STRINGS.rail.masks, icon: 'masks' },
    { id: 'enhance', label: STRINGS.rail.enhance, icon: 'focus' },
    { id: 'overlays', label: STRINGS.rail.overlays, icon: 'overlay' },
    { id: 'assist', label: STRINGS.rail.assist, icon: 'assist' },
    { id: 'info', label: STRINGS.rail.info, icon: 'info' },
    { id: 'tasks', label: STRINGS.rail.tasks, icon: 'clock' },
  ];

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
        className="hidden md:flex w-[var(--rail-width)] shrink-0 flex-col items-center justify-between border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] py-2 select-none"
      >
        <div className="flex w-full flex-col items-center gap-0.5 overflow-y-auto inflight-scroll px-1.5">
          {items.map((item) => {
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
                {item.id === 'tasks' && runningTaskCount > 0 && !calmView && (
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

        <div className="w-full border-t border-[var(--border-subtle)] pt-2 px-1.5">
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
