import React, { useRef, useState } from 'react';
import type { Project } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';

/** How the Projects page lays out its projects. Remembered on this device only. */
export type HubLayout = 'list' | 'tiles';

// The key and values the first compact list (#1344) stored, so a choice made there carries over.
const LAYOUT_KEY = 'inflight-v2-hub-layout';

export function readHubLayout(): HubLayout {
  try { return globalThis.localStorage?.getItem(LAYOUT_KEY) === 'cards' ? 'tiles' : 'list'; } catch { return 'list'; }
}

export function saveHubLayout(layout: HubLayout): void {
  try { globalThis.localStorage?.setItem(LAYOUT_KEY, layout === 'tiles' ? 'cards' : 'compact'); } catch { /* private window: the choice lasts this visit */ }
}

/** List or Tiles: two buttons in one group, the chosen one pressed, so the state never depends on colour alone. */
export function LayoutToggle({ value, onChange }: { value: HubLayout; onChange: (layout: HubLayout) => void }) {
  const option = (layout: HubLayout, label: string, icon: React.ReactNode) => (
    <button type="button" aria-pressed={value === layout} onClick={() => onChange(layout)} title={label}
      className={`inline-flex h-full min-w-10 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)] ${value === layout ? 'bg-[var(--bg-surface-hover)] font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
      {icon}<span className="sr-only lg:not-sr-only">{label}</span>
    </button>
  );
  return (
    <div role="group" aria-label={STRINGS.hubMore.layoutLabel} data-testid="hub-layout"
      className="inline-flex h-10 items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-0.5">
      {option('list', STRINGS.hubMore.layoutList, <ListIcon />)}
      {option('tiles', STRINGS.hubMore.layoutTiles, <BrandIcon name="grid" size={15} />)}
    </div>
  );
}

function ListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="4" width="6" height="6" rx="1" /><rect x="3" y="14" width="6" height="6" rx="1" />
      <path d="M13 6h8M13 9h5M13 16h8M13 19h5" />
    </svg>
  );
}

export interface ProjectCardProps {
  project: Project;
  coverFailed: boolean;
  onCoverError: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onOpen: () => void;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

function Cover({ project, coverFailed, onCoverError, iconSize }: Pick<ProjectCardProps, 'project' | 'coverFailed' | 'onCoverError'> & { iconSize: number }) {
  return project.coverUrl && !coverFailed ? (
    <img src={project.coverUrl} loading="lazy" alt={STRINGS.hubMore.coverAlt(project.name)} referrerPolicy="no-referrer" onError={onCoverError}
      className="h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-[1.03]" />
  ) : (
    <span className="flex h-full w-full items-center justify-center text-[var(--text-secondary)]" title={STRINGS.hubMore.coverUnavailable}>
      <BrandIcon name="folder-open" size={iconSize} />
      <span className="sr-only">{STRINGS.hubMore.coverUnavailable}</span>
    </span>
  );
}

function Meta({ project }: { project: Project }) {
  return (
    <>
      {project.kind === 'collage' && <span className="mr-1.5 rounded-full border border-[var(--border-default)] px-1.5 py-px text-[10px] font-medium text-[var(--text-secondary)]">{STRINGS.hubMore.collageTag}</span>}
      {STRINGS.hub.photosCount(project.photoCount)} · {STRINGS.hub.flaggedCount(project.flaggedCount)} · {project.updatedAt}
    </>
  );
}

function StorageStatus({ project, compact }: { project: Project; compact?: boolean }) {
  const synced = project.localCopyStatus === 'synced';
  const label = synced ? STRINGS.hubMore.synced : STRINGS.hubMore.offlineReady;
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]" title={label}>
      <BrandIcon name={synced ? 'cloud' : 'hard-drive'} size={13} className="shrink-0 text-[var(--semantic-success)]" />
      <span className={compact ? 'sr-only' : 'truncate'}>{label}</span>
    </span>
  );
}

function ActionsMenu({ project, menuOpen, onToggleMenu, onRename, onArchive, onDelete, opensUp }: Pick<ProjectCardProps, 'project' | 'menuOpen' | 'onToggleMenu' | 'onRename' | 'onArchive' | 'onDelete'> & { opensUp?: boolean }) {
  const item = 'flex min-h-10 w-full items-center px-3 text-left text-xs hover:bg-[var(--bg-surface-hover)]';
  return (
    <div className="relative shrink-0">
      <button type="button" aria-label={STRINGS.hubMore.actionsFor(project.name)} aria-haspopup="menu" aria-expanded={menuOpen} onClick={onToggleMenu}
        className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {menuOpen && (
        <div role="menu" aria-label={STRINGS.hubMore.actionsMenu} className={`absolute right-0 z-30 w-44 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] py-1 shadow-[var(--shadow-popover)] ${opensUp ? 'bottom-11' : 'top-11'}`}>
          {!project.trashed && <button type="button" role="menuitem" className={`${item} text-[var(--text-primary)]`} onClick={() => { onToggleMenu(); onRename(); }}>{STRINGS.hubMore.rename}</button>}
          <button type="button" role="menuitem" className={`${item} text-[var(--text-primary)]`} onClick={() => { onToggleMenu(); onArchive(); }}>{project.archived || project.trashed ? STRINGS.hubMore.restore : STRINGS.hubMore.archive}</button>
          <button type="button" role="menuitem" className={`${item} text-[var(--status-danger,#e5484d)]`} onClick={() => { onToggleMenu(); onDelete(); }}>{project.trashed ? STRINGS.hubMore.deleteForeverMenu : STRINGS.hubMore.deleteMenu}</button>
        </div>
      )}
    </div>
  );
}

/** Width of each action revealed by a swipe. */
const SWIPE_ACTION = 72;
const SWIPE_ACTIONS = 3;

/**
 * One project in the list: its best favourite and up to three more on the left, what it is on the right. On a touch screen
 * a finger can slide the row left to reveal Rename, Archive and Delete, as in the first version of the app. Touch events never
 * come from a mouse or pen, so desktop never slides by accident, and the ⋯ menu offers the same actions to everyone.
 * Delete still asks before anything is removed.
 */
export function ProjectRow(props: ProjectCardProps) {
  const { project, onOpen, onRename, onArchive, onDelete } = props;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; from: number; moved: boolean } | null>(null);
  const full = SWIPE_ACTION * SWIPE_ACTIONS;
  const open = offset <= -full / 2;
  const close = () => setOffset(0);
  const samples = (project.sampleUrls ?? []).slice(0, 3);
  const swipeButton = 'flex w-[72px] flex-col items-center justify-center gap-1 text-[11px] font-medium text-white focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-white';
  return (
    <li className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]" data-testid="project-row">
      <div className="absolute inset-y-0 right-0 flex" inert={!open} aria-hidden={!open}>
        <button type="button" tabIndex={open ? 0 : -1} onClick={() => { close(); onRename(); }} className={`${swipeButton} bg-[#3f4a5a]`}>
          <BrandIcon name="pencil" size={18} />{STRINGS.hubMore.rename}
        </button>
        <button type="button" tabIndex={open ? 0 : -1} onClick={() => { close(); onArchive(); }} className={`${swipeButton} bg-[#1f5f86]`}>
          <BrandIcon name={project.archived || project.trashed ? 'restore' : 'archive'} size={18} />{project.archived || project.trashed ? STRINGS.hubMore.restore : STRINGS.hubMore.archive}
        </button>
        <button type="button" tabIndex={open ? 0 : -1} onClick={() => { close(); onDelete(); }} className={`${swipeButton} bg-[#a3262b]`}>
          <BrandIcon name="trash" size={18} />{project.trashed ? STRINGS.hubMore.deleteForeverMenu : STRINGS.hubMore.deleteMenu}
        </button>
      </div>
      <div data-testid="project-row-body"
        className="group relative flex touch-pan-y items-center gap-3 bg-[var(--bg-surface)] p-2 pr-1 motion-reduce:!transition-none sm:gap-4 sm:p-2.5"
        style={{ transform: `translateX(${offset}px)`, transition: dragging ? 'none' : 'transform 160ms ease-out' }}
        onTouchStart={(event) => {
          if (event.touches.length !== 1) return;
          const touch = event.touches[0];
          start.current = { x: touch.clientX, y: touch.clientY, from: offset, moved: false };
        }}
        onTouchMove={(event) => {
          const gesture = start.current;
          if (!gesture || event.touches.length !== 1) return;
          const dx = event.touches[0].clientX - gesture.x, dy = event.touches[0].clientY - gesture.y;
          if (!gesture.moved && (Math.abs(dx) < 8 || Math.abs(dy) > Math.abs(dx))) return;
          gesture.moved = true;
          setDragging(true);
          setOffset(Math.max(-full, Math.min(0, gesture.from + dx)));
        }}
        onTouchEnd={() => {
          const gesture = start.current;
          start.current = null;
          setDragging(false);
          if (gesture?.moved) setOffset((value) => (value < -SWIPE_ACTION * 0.75 ? -full : 0));
        }}
        onTouchCancel={() => { const gesture = start.current; start.current = null; setDragging(false); if (gesture) setOffset(gesture.from); }}
        onClickCapture={(event) => { if (offset !== 0) { event.preventDefault(); event.stopPropagation(); close(); } }}>
        {/* The cover is a pointer shortcut only (the name button opens it for keyboards), so it is not a second button, and its picture keeps its name for screen readers. */}
        <div onClick={onOpen}
          className="flex h-16 shrink-0 cursor-pointer gap-0.5 overflow-hidden rounded-[var(--radius-md)] bg-[var(--bg-canvas)] sm:h-28">
          <span className="block aspect-[3/2] h-full overflow-hidden">
            <Cover project={project} coverFailed={props.coverFailed} onCoverError={props.onCoverError} iconSize={22} />
          </span>
          {samples.length > 0 && (
            <span className="grid aspect-[1/3] h-full grid-rows-3 gap-0.5" data-testid="project-samples">
              {samples.map((url) => <img key={url} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />)}
            </span>
          )}
        </div>
        {/* A tap anywhere in the text opens the project; keyboard users reach the same through the name button. */}
        <div className="min-w-0 flex-1 cursor-pointer" onClick={(event) => { if (event.target === event.currentTarget || !(event.target as HTMLElement).closest('button')) onOpen(); }}>
          <button type="button" onClick={onOpen}
            className="block max-w-full truncate text-left text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--brand-accent)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
            {project.name}
          </button>
          <p className="mt-1 text-xs text-[var(--text-secondary)] tabular-nums"><Meta project={project} /></p>
          {project.folderPath && <p className="mt-1 hidden truncate font-mono text-[11px] text-[var(--text-muted)] sm:block">{project.folderPath}</p>}
          <div className="mt-1.5 hidden sm:block"><StorageStatus project={project} /></div>
        </div>
        <button type="button" onClick={onOpen}
          className="hidden shrink-0 items-center gap-1 rounded-[var(--radius-md)] px-2 py-2 text-xs font-semibold text-[var(--brand-accent)] hover:underline md:inline-flex">
          <span>{STRINGS.hub.openProject}</span><BrandIcon name="arrow" size={13} />
        </button>
        <ActionsMenu {...props} />
      </div>
    </li>
  );
}

/** A smaller tile than before: about six across on a wide screen, two on a phone. */
export function ProjectTile(props: ProjectCardProps) {
  const { project, onOpen } = props;
  return (
    <li className="group flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-colors hover:border-[var(--brand-accent-border)]" data-testid="project-tile">
      <div onClick={onOpen} className="relative aspect-[3/2] w-full cursor-pointer overflow-hidden bg-[var(--bg-canvas)]">
        <Cover project={project} coverFailed={props.coverFailed} onCoverError={props.onCoverError} iconSize={24} />
      </div>
      <div className="flex min-w-0 items-start gap-1 p-2 pr-1">
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen}
            className="block max-w-full truncate text-left text-xs font-semibold text-[var(--text-primary)] hover:text-[var(--brand-accent)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
            {project.name}
          </button>
          <p className="mt-0.5 truncate text-[11px] text-[var(--text-secondary)] tabular-nums"><Meta project={project} /></p>
          <div className="mt-1"><StorageStatus project={project} compact /></div>
        </div>
        <ActionsMenu {...props} opensUp />
      </div>
    </li>
  );
}
