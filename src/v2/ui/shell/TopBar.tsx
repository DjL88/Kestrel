import React, { useEffect, useRef, useState } from 'react';
import type { AssistMode, DockPosition, PanelId, ThemeMode } from '../contract';
import { STRINGS } from '../strings';
import { chordLabel, type Keymap } from '../commands/keymap';
import BrandIcon, { BrandLogo, assistModeIconName } from '../icons/BrandIcon';

interface TopBarProps {
  /**
   * The File, Edit and View menus (wide screens only). On by default: the desktop app's native menu is the older V1
   * menu and has no V2 actions such as Removed photos, so hiding these left those actions with no way in.
   */
  showMenus?: boolean;
  photoName: string;
  /** Phone only: where this photo is in the project, e.g. "2 of 20". */
  photoPosition?: string;
  /**
   * The same effective keymap App.tsx's dispatcher runs, lifted down as a prop rather than
   * loaded independently here. Before this, TopBar re-read the saved keymap itself and only
   * refreshed on focus/focusin/storage, while App.tsx's dispatcher (prior to #976) didn't
   * refresh at all - a same-tab rebind could show a shortcut here that the editor wouldn't
   * actually run. One source of truth removes that drift by construction.
   */
  keymap: Keymap;
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
  /** Opens Share (shared projects, #1387). Absent: no Share button. */
  onShare?: () => void;
  /** Who else is in this shared project (PresenceAvatars). */
  presence?: React.ReactNode;
  onOpenRemoved: () => void;
  onSaveXmp?: () => void;
  onBackUpNow?: () => void;
  onSaveBackupFile?: () => void;
  /** The open project's last automatic backup, in words, shown under Back up now. */
  backupNote?: string;
  onReadXmp?: () => void;
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
  showMenus = true,
  photoName,
  photoPosition,
  keymap: shortcutMap,
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
  onShare,
  presence,
  onOpenRemoved,
  onSaveXmp,
  onBackUpNow,
  onSaveBackupFile,
  backupNote,
  onReadXmp,
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
  const menuTriggers = useRef<Partial<Record<Exclude<OpenMenu, null>, HTMLButtonElement | null>>>({});
  const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

  useEffect(() => {
    if (!openMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        menuTriggers.current[openMenu]?.focus();
        setOpenMenu(null);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [openMenu]);

  useEffect(() => {
    if (!openMenu) return;
    // Focus the first enabled action rather than leaving keyboard users on a trigger
    // while its menu has opened over the workspace.
    const menu = menuRef.current?.querySelector<HTMLElement>('[role="menu"]');
    menu?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [openMenu]);

  const handleMenuKeys = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!openMenu || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End')) return;
    const menu = menuRef.current?.querySelector<HTMLElement>('[role="menu"]');
    if (!menu?.contains(event.target as Node)) return;
    const actions = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    if (!actions.length) return;
    event.preventDefault();
    const current = actions.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? actions.length - 1
      : event.key === 'ArrowDown' ? (current + 1) % actions.length
      : (current < 0 ? 0 : current - 1 + actions.length) % actions.length;
    actions[next]?.focus();
  };

  const runAndClose = (fn: () => void) => {
    fn();
    setOpenMenu(null);
  };

  const modes: AssistMode[] = ['solo', 'copilot', 'autopilot'];

  return (
    <header
      className="relative z-40 flex h-[var(--topbar-height)] shrink-0 items-center justify-between gap-1 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 md:gap-4 md:px-4"
      aria-label={STRINGS.shellLabels.studioHeader}
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
          <span className="hidden sm:inline">{STRINGS.topBar.backShort}</span>
        </button>

        <div className="hidden h-5 w-px bg-[var(--border-subtle)] shrink-0 md:block" aria-hidden="true" />

        <div className="hidden items-center px-1 shrink-0 md:flex">
          <BrandLogo height={38} className="h-auto w-[92px] md:w-[124px]" />
        </div>

        {/* Phone: the photo's name and where it is in the project, in place of the logo (owner wireframe, 26.3). */}
        <div className="flex min-w-0 flex-col leading-tight md:hidden" data-testid="phone-photo-title">
          <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{photoName}</span>
          {photoPosition && <span className="truncate text-xs text-[var(--text-secondary)]">{photoPosition}</span>}
        </div>

        {/* Desktop menus: File, Edit, View */}
        {showMenus && <nav onKeyDown={handleMenuKeys} className="hidden lg:flex items-center gap-1 ml-1" aria-label={STRINGS.topBar.applicationMenus}>
          {/* File Menu */}
          <div className="relative">
            <button
              type="button"
              ref={(node) => { menuTriggers.current.file = node; }}
              aria-haspopup="menu"
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
                  icon="restore"
                  label={STRINGS.topBar.fileActions.removedPhotos}
                  onClick={() => runAndClose(onOpenRemoved)}
                />
                {onSaveXmp && onReadXmp && (
                  <>
                    <div className="my-1 h-px bg-[var(--border-subtle)]" />
                    <MenuItem icon="save" label={STRINGS.xmp.saveMenu} onClick={() => runAndClose(onSaveXmp)} />
                    <MenuItem icon="folder-open" label={STRINGS.xmp.readMenu} onClick={() => runAndClose(onReadXmp)} />
                  </>
                )}
                {onBackUpNow && onSaveBackupFile && (
                  <>
                    <div className="my-1 h-px bg-[var(--border-subtle)]" />
                    <MenuItem icon="cloud" label={STRINGS.backup.backUpNow} onClick={() => runAndClose(onBackUpNow)} />
                    {backupNote && <p role="note" data-testid="backup-note" className="px-3 pb-1.5 pl-[2.375rem] text-[0.6875rem] leading-snug text-[var(--text-muted)]">{backupNote}</p>}
                    <MenuItem icon="save" label={STRINGS.backup.saveFile} onClick={() => runAndClose(onSaveBackupFile)} />
                  </>
                )}
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
              ref={(node) => { menuTriggers.current.edit = node; }}
              aria-haspopup="menu"
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
              ref={(node) => { menuTriggers.current.view = node; }}
              aria-haspopup="menu"
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
        <div role="group" aria-label={STRINGS.shellLabels.editHistory} className="flex md:hidden">
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
        {presence}
        {onShare && (
          <button
            type="button"
            onClick={onShare}
            data-testid="share-button"
            className="inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] border border-[var(--border-default)] px-2.5 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface-hover)] md:h-9 md:px-3.5"
          >
            <BrandIcon name="link" size={15} />
            <span className="v2-phone-label">{STRINGS.share.button}</span>
          </button>
        )}
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
      <span className="flex items-center gap-1.5 shrink-0 text-[0.6875rem] text-[var(--text-muted)]">
        {checked && <BrandIcon name="check" size={12} className="text-[var(--brand-accent)]" />}
        {shortcut && <span className="font-mono">{shortcut}</span>}
      </span>
    </button>
  );
}
