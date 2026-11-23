import React, { useEffect, useRef, useState } from 'react';
import type { AssistMode, DockPosition, PanelId, ThemeMode } from '../contract';
import { STRINGS } from '../strings';
import { chordLabel, effectiveKeymap, loadKeymap } from '../commands/keymap';
import BrandIcon, { BrandLogo, assistModeIconName } from '../icons/BrandIcon';

interface TopBarProps {
  /** The File, Edit and View menus. Off in the interface: the desktop app has them natively. */
  showMenus?: boolean;
  photoName: string;
  assistMode: AssistMode;
  theme: ThemeMode;
  activePanel: PanelId | null;
  canUndo: boolean;
  canRedo: boolean;
  hasClipboardRecipe: boolean;
  compareMode: boolean;
  gridViewOpen: boolean;
  filmstripCollapsed: boolean;
  onBack: () => void;
  onSetAssistMode: (mode: AssistMode) => void;
  onExport: () => void;
  onOpenSettings: () => void;
  onImport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopyRecipe: () => void;
  onPasteRecipe: () => void;
  onResetPhoto: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onToggleFilmstrip: () => void;
  onToggleGridView: () => void;
  onToggleCompare: () => void;
  onDockActivePanel: (dock: DockPosition) => void;
  onResetLayout: () => void;
  onToggleTheme: () => void;
  onToggleDemoUnavailable: () => void;
}

type OpenMenu = 'file' | 'edit' | 'view' | null;

export default function TopBar({
  showMenus = false,
  photoName,
  assistMode,
  theme,
  activePanel,
  canUndo,
  canRedo,
  hasClipboardRecipe,
  compareMode,
  gridViewOpen,
  filmstripCollapsed,
  onBack,
  onSetAssistMode,
  onExport,
  onOpenSettings,
  onImport,
  onUndo,
  onRedo,
  onCopyRecipe,
  onPasteRecipe,
  onResetPhoto,
  onSelectAll,
  onClearSelection,
  onToggleFilmstrip,
  onToggleGridView,
  onToggleCompare,
  onDockActivePanel,
  onResetLayout,
  onToggleTheme,
  onToggleDemoUnavailable,
}: TopBarProps) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Match the same saved preset and overrides used by the workspace key handler.
  const [shortcutMap, setShortcutMap] = useState(() => {
    const saved = loadKeymap();
    return effectiveKeymap(saved.preset, saved.overrides);
  });
  // Settings can change the saved preset while the studio stays mounted.
  // Focus returning to a studio control also refreshes same-tab changes: the
  // browser's storage event only fires in other tabs, not the writing tab.
  useEffect(() => {
    const refreshShortcuts = () => {
      const saved = loadKeymap();
      setShortcutMap(effectiveKeymap(saved.preset, saved.overrides));
    };
    window.addEventListener('focus', refreshShortcuts);
    window.addEventListener('focusin', refreshShortcuts);
    window.addEventListener('storage', refreshShortcuts);
    return () => {
      window.removeEventListener('focus', refreshShortcuts);
      window.removeEventListener('focusin', refreshShortcuts);
      window.removeEventListener('storage', refreshShortcuts);
    };
  }, []);
  const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

  useEffect(() => {
    if (!openMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [openMenu]);

  const runAndClose = (fn: () => void) => {
    fn();
    setOpenMenu(null);
  };

  const modes: AssistMode[] = ['solo', 'copilot', 'autopilot'];

  return (
    <header
      className="relative z-40 flex h-[var(--topbar-height)] shrink-0 items-center justify-between gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 md:gap-4 md:px-4"
      aria-label="InFlight studio header"
    >
      {/* Left zone: Back button + InFlight logo + File / Edit / View desktop menus */}
      <div className="flex min-w-0 items-center gap-2 md:gap-3" ref={menuRef}>
        <button
          type="button"
          onClick={onBack}
          aria-label={STRINGS.topBar.backToProjects}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] whitespace-nowrap shrink-0"
        >
          <BrandIcon name="arrow-left" size={16} />
          <span className="hidden sm:inline">Back</span>
        </button>

        <div className="h-5 w-px bg-[var(--border-subtle)] shrink-0" aria-hidden="true" />

        <div className="flex items-center px-1 shrink-0">
          <BrandLogo height={38} className="h-auto w-[92px] md:w-[124px]" />
        </div>

        {/* Desktop menus: File, Edit, View */}
        {showMenus && <nav className="hidden lg:flex items-center gap-1 ml-1" aria-label="Application menus">
          {/* File Menu */}
          <div className="relative">
            <button
              type="button"
              aria-expanded={openMenu === 'file'}
              onClick={() => setOpenMenu((m) => (m === 'file' ? null : 'file'))}
              className={`h-8 rounded-[var(--radius-sm)] px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                openMenu === 'file'
                  ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              {STRINGS.topBar.fileMenu}
            </button>
            {openMenu === 'file' && (
              <div
                role="menu"
                className="absolute left-0 top-full mt-1.5 w-56 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] py-1.5 shadow-[var(--shadow-popover)]"
              >
                <MenuItem
                  icon="image-plus"
                  label={STRINGS.topBar.fileActions.importPhotos}
                  shortcut="⌘I"
                  onClick={() => runAndClose(onImport)}
                />
                <MenuItem
                  icon="export"
                  label={STRINGS.topBar.fileActions.exportSelected}
                  shortcut="⌘E"
                  onClick={() => runAndClose(onExport)}
                />
                <div className="my-1 h-px bg-[var(--border-subtle)]" />
                <MenuItem
                  icon="settings"
                  label={STRINGS.topBar.fileActions.settings}
                  shortcut="⌘,"
                  onClick={() => runAndClose(onOpenSettings)}
                />
                <MenuItem
                  icon="folder"
                  label={STRINGS.topBar.fileActions.backToProjects}
                  onClick={() => runAndClose(onBack)}
                />
              </div>
            )}
          </div>

          {/* Edit Menu */}
          <div className="relative">
            <button
              type="button"
              aria-expanded={openMenu === 'edit'}
              onClick={() => setOpenMenu((m) => (m === 'edit' ? null : 'edit'))}
              className={`h-8 rounded-[var(--radius-sm)] px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                openMenu === 'edit'
                  ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              {STRINGS.topBar.editMenu}
            </button>
            {openMenu === 'edit' && (
              <div
                role="menu"
                className="absolute left-0 top-full mt-1.5 w-56 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] py-1.5 shadow-[var(--shadow-popover)]"
              >
                <MenuItem
                  icon="undo"
                  label={STRINGS.topBar.editActions.undo}
                  shortcut="⌘Z"
                  disabled={!canUndo}
                  onClick={() => runAndClose(onUndo)}
                />
                <MenuItem
                  icon="refresh"
                  label={STRINGS.topBar.editActions.redo}
                  shortcut="⇧⌘Z"
                  disabled={!canRedo}
                  onClick={() => runAndClose(onRedo)}
                />
                <div className="my-1 h-px bg-[var(--border-subtle)]" />
                <MenuItem
                  icon="copy"
                  label={STRINGS.topBar.editActions.copyAdjustments}
                  shortcut="⌘C"
                  onClick={() => runAndClose(onCopyRecipe)}
                />
                <MenuItem
                  icon="paste"
                  label={STRINGS.topBar.editActions.pasteAdjustments}
                  shortcut="⌘V"
                  disabled={!hasClipboardRecipe}
                  onClick={() => runAndClose(onPasteRecipe)}
                />
                <MenuItem
                  icon="restore"
                  label={STRINGS.topBar.editActions.resetAdjustments}
                  onClick={() => runAndClose(onResetPhoto)}
                />
                <div className="my-1 h-px bg-[var(--border-subtle)]" />
                <MenuItem
                  icon="select-photos"
                  label={STRINGS.topBar.editActions.selectAll}
                  shortcut="⌘A"
                  onClick={() => runAndClose(onSelectAll)}
                />
                <MenuItem
                  icon="close"
                  label={STRINGS.topBar.editActions.clearSelection}
                  shortcut="Esc"
                  onClick={() => runAndClose(onClearSelection)}
                />
              </div>
            )}
          </div>

          {/* View Menu */}
          <div className="relative">
            <button
              type="button"
              aria-expanded={openMenu === 'view'}
              onClick={() => setOpenMenu((m) => (m === 'view' ? null : 'view'))}
              className={`h-8 rounded-[var(--radius-sm)] px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                openMenu === 'view'
                  ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
              }`}
            >
              {STRINGS.topBar.viewMenu}
            </button>
            {openMenu === 'view' && (
              <div
                role="menu"
                className="absolute left-0 top-full mt-1.5 w-64 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] py-1.5 shadow-[var(--shadow-popover)]"
              >
                <MenuItem
                  icon="grid"
                  label={STRINGS.topBar.viewActions.gridView}
                  checked={gridViewOpen}
                  onClick={() => runAndClose(onToggleGridView)}
                />
                <MenuItem
                  icon="panel-collapse"
                  label={STRINGS.topBar.viewActions.toggleFilmstrip}
                  checked={!filmstripCollapsed}
                  onClick={() => runAndClose(onToggleFilmstrip)}
                />
                <MenuItem
                  icon="compare"
                  label={STRINGS.topBar.viewActions.compareBeforeAfter}
                  checked={compareMode}
                  onClick={() => runAndClose(onToggleCompare)}
                />
                <div className="my-1 h-px bg-[var(--border-subtle)]" />
                <MenuItem
                  icon="panel"
                  label={STRINGS.topBar.viewActions.dockLeft}
                  disabled={!activePanel}
                  onClick={() => runAndClose(() => onDockActivePanel('left'))}
                />
                <MenuItem
                  icon="panel"
                  label={STRINGS.topBar.viewActions.dockRight}
                  disabled={!activePanel}
                  onClick={() => runAndClose(() => onDockActivePanel('right'))}
                />
                <MenuItem
                  icon="float"
                  label={STRINGS.topBar.viewActions.floatPanel}
                  disabled={!activePanel}
                  onClick={() => runAndClose(() => onDockActivePanel('float'))}
                />
                <MenuItem
                  icon="restore"
                  label={STRINGS.topBar.viewActions.resetLayout}
                  onClick={() => runAndClose(onResetLayout)}
                />
                <div className="my-1 h-px bg-[var(--border-subtle)]" />
                <MenuItem
                  icon={theme === 'dark' ? 'theme-light' : 'theme-dark'}
                  label={STRINGS.topBar.viewActions.switchTheme}
                  onClick={() => runAndClose(onToggleTheme)}
                />
                <MenuItem
                  icon="image-off"
                  label={STRINGS.topBar.viewActions.previewUnavailable}
                  onClick={() => runAndClose(onToggleDemoUnavailable)}
                />
              </div>
            )}
          </div>
        </nav>}
      </div>

      {/* Centre zone: Current photo name (clean single-line) */}
      <div className="hidden md:flex min-w-0 max-w-xs lg:max-w-sm items-center justify-center">
        <span className="truncate text-xs font-medium text-[var(--text-secondary)]">
          {photoName}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1 md:gap-3">
        <div role="group" aria-label="Edit history" className="flex md:hidden">
          {([
            { icon: 'undo', label: STRINGS.topBar.editActions.undo, shortcut: shortcutMap['edit.undo'], enabled: canUndo, action: onUndo },
            { icon: 'refresh', label: STRINGS.topBar.editActions.redo, shortcut: shortcutMap['edit.redo'], enabled: canRedo, action: onRedo },
          ] as const).map(({ icon, label, shortcut, enabled, action }) => (
            <button
              key={icon}
              type="button"
              aria-label={label}
              title={`${label} (${chordLabel(shortcut, isMac)})`}
              disabled={!enabled}
              onClick={action}
              className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
            >
              <BrandIcon name={icon} size={17} />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onExport}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-2.5 text-xs font-semibold text-[var(--text-on-accent)] transition-colors hover:bg-[var(--brand-accent-hover)] md:h-9 md:px-3.5"
        >
          <BrandIcon name="export" size={15} />
          <span>{STRINGS.topBar.exportButton}</span>
        </button>
      </div>
    </header>
  );
}

interface MenuItemProps {
  icon: Parameters<typeof BrandIcon>[0]['name'];
  label: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  onClick: () => void;
}

function MenuItem({ icon, label, shortcut, disabled, checked, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors ${
        disabled
          ? 'cursor-not-allowed text-[var(--text-muted)] opacity-50'
          : 'text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]'
      }`}
    >
      <span className="flex items-center gap-2.5 min-w-0">
        <BrandIcon name={icon} size={14} className="text-[var(--text-secondary)]" />
        <span className="truncate">{label}</span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0 text-[11px] text-[var(--text-muted)]">
        {checked && <BrandIcon name="check" size={12} className="text-[var(--brand-accent)]" />}
        {shortcut && <span className="font-mono">{shortcut}</span>}
      </span>
    </button>
  );
}
