import { useRef, useState } from 'react';
import { Archive, ArchiveRestore, ChevronRight, Folder, FolderUp, Plus, Search, Settings2, SquareChevronsRight, Trash2 } from './icons/KestrelUIIcons';
import { BrandLogo } from './BrandLogo';
import { version as appVersion } from '../../package.json';
import { PHOTO_ACCEPT } from '../core/rawFormats';
import { LicenceAndSettings } from './LicenceAndSettings';
import { SettingsButton } from './SettingsButton';
import { AppearanceDialog } from './AppearanceDialog';
import type { ShootDescriptor } from '../core/types';
import { NewProjectWizard } from './NewProjectWizard';
import { LanguageWelcome } from './LanguageWelcome';
import { CatalogueStorage } from './CatalogueStorage';
import type { ProjectSettings } from '../core/projectSettings';
import { filterProjects, inboxFirst, sortProjects, splitProjects, type ProjectSort } from '../core/projects';
import { formatProjectDate } from '../core/formatDate';
import { messages as m } from '../i18n/messages';
import { projectsText as t } from '../i18n/areas/projects';

interface Props {
  projects: ShootDescriptor[];
  /** Searchable text of each project's photos, by project id. */
  photoText?: Record<string, string>;
  loading: boolean;
  error?: string;
  onOpen: (id: string) => void;
  onCreate: (name: string, options: { keeperTarget: number; settings: ProjectSettings }) => void;
  onRestore: (file: File) => void;
  onArchive: (project: ShootDescriptor) => void;
  onUnarchive: (id: string) => void;
  onDelete: (project: ShootDescriptor) => void;
  /** Open photos straight into the editor, without making a project first. */
  onQuickEdit: (files: File[]) => void;
  editPanelSide: 'left' | 'right';
  onEditPanelSideChange: (side: 'left' | 'right') => void;
  onOpenMacroPad?: () => void;
}

const ACTION = 76;

/**
 * A project row that, for a finger only (touch events never come from a mouse or pen), slides left to reveal the project actions.
 * A mouse or pen never slides it: desktop keeps its visible buttons, and nothing moves by accident.
 */
function SwipeRow({ children, archived, title, onArchive, onDelete, disabled }: {
  children: React.ReactNode; archived: boolean; title: string; onArchive: () => void; onDelete: () => void; disabled: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; from: number; moved: boolean } | null>(null);
  const open = offset <= -ACTION / 2;
  const settle = (value: number) => (value < -ACTION * 0.5 ? -ACTION * 2 : 0);
  const back = () => setOffset(0);
  return (
    <li className="relative overflow-hidden">
      <div className="absolute inset-y-0 right-0 flex" inert={!open} aria-hidden={!open}>
        <button type="button" tabIndex={open ? 0 : -1} disabled={disabled} onClick={() => { back(); onArchive(); }} aria-label={archived ? t.list.restoreNamed(title) : t.list.archiveNamed(title)}
          className="grid w-[76px] place-items-center bg-sky-900 text-xs font-medium text-white">
          {archived ? <ArchiveRestore className="mx-auto h-5 w-5" aria-hidden="true" /> : <Archive className="mx-auto h-5 w-5" aria-hidden="true" />}
          {archived ? t.list.restore : t.list.archive}
        </button>
        <button type="button" tabIndex={offset <= -ACTION * 1.5 ? 0 : -1} disabled={disabled} onClick={() => { back(); onDelete(); }} aria-label={t.list.deleteNamed(title)}
          className="grid w-[76px] place-items-center bg-red-900 text-xs font-medium text-white">
          <Trash2 className="mx-auto h-5 w-5" aria-hidden="true" />{t.list.delete}
        </button>
      </div>
      <div data-testid="swipe-row" className="relative flex touch-pan-y items-center gap-1 bg-kestrel-raised pr-1"
        style={{ transform: `translateX(${offset}px)`, transition: dragging ? 'none' : 'transform 160ms ease-out' }}
        onTouchStart={(event) => {
          if (event.touches.length !== 1) return;
          const touch = event.touches[0];
          start.current = { x: touch.clientX, y: touch.clientY, from: offset, moved: false };
        }}
        onTouchMove={(event) => {
          const s0 = start.current;
          if (!s0 || event.touches.length !== 1) return;
          const dx = event.touches[0].clientX - s0.x, dy = event.touches[0].clientY - s0.y;
          if (!s0.moved && (Math.abs(dx) < 8 || Math.abs(dy) > Math.abs(dx))) return;
          s0.moved = true;
          setDragging(true);
          setOffset(Math.max(-ACTION * 2, Math.min(0, s0.from + dx)));
        }}
        onTouchEnd={() => { const s0 = start.current; start.current = null; setDragging(false); if (s0?.moved) setOffset((value) => settle(value)); }}
        onTouchCancel={() => { const gesture = start.current; start.current = null; setDragging(false); if (gesture) setOffset(gesture.from); }}
        onClickCapture={(event) => { if (offset !== 0) { event.preventDefault(); event.stopPropagation(); back(); } }}>
        {children}
      </div>
    </li>
  );
}

export function ProjectList({ projects, photoText = {}, loading, error, onOpen, onCreate, onRestore, onArchive, onUnarchive, onDelete, onQuickEdit, editPanelSide, onEditPanelSideChange, onOpenMacroPad }: Props) {
  const [licenceOpen, setLicenceOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ProjectSort>('edited');
  const backupInput = useRef<HTMLInputElement>(null);
  const quickInput = useRef<HTMLInputElement>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutTouchY = useRef<number | null>(null);
  return (
    <main className="h-dvh max-h-dvh w-full max-w-full min-w-0 flex flex-col overflow-hidden bg-kestrel-canvas px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-zinc-100 sm:px-8">
      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col pt-4 sm:pt-10">
        <div className="relative mb-7 flex items-start justify-center">
          <BrandLogo kind="stacked" className="h-auto w-44 sm:w-52" />
          <div className="absolute right-0 top-0"><SettingsButton open={appearanceOpen} onOpen={() => setAppearanceOpen(true)} /></div>
        </div>
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{m.home.projects}</h1>
          <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto">
          <input ref={backupInput} type="file" accept=".json,application/json" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onRestore(file);
          }} />
          <button type="button" onClick={() => backupInput.current?.click()} disabled={loading}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-zinc-300 hover:bg-white/8 max-sm:hidden">
            <FolderUp className="h-4 w-4" aria-hidden="true" /> {m.home.restoreBackup}
          </button>
          <input ref={quickInput} type="file" accept={PHOTO_ACCEPT} multiple hidden data-testid="quick-edit-input" onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            if (files.length) onQuickEdit(files);
          }} />
          <button type="button" onClick={() => quickInput.current?.click()} disabled={loading} title={t.list.quickEditHint}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-sky-300/50 px-3 text-sm text-sky-100 hover:bg-sky-300/15 disabled:opacity-50">
            <SquareChevronsRight className="h-4 w-4" aria-hidden="true" /> {m.home.quickEdit}
          </button>
          <button type="button" onClick={() => setCreating(!creating)} disabled={loading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-kestrel-copper hover:bg-kestrel-copper-hover! px-3 text-sm font-semibold text-zinc-950 disabled:opacity-50">
            <Plus className="h-4 w-4" aria-hidden="true" /> {m.home.newProject}
          </button>
          </div>
        </header>
        <p className="-mt-3 mb-5 text-center sm:hidden">
          <button type="button" onClick={() => backupInput.current?.click()} disabled={loading} className="min-h-11 px-3 text-sm text-zinc-300 underline underline-offset-4 hover:text-white">
            {m.home.restoreBackup}
          </button>
        </p>
        {projects.length > 1 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1 basis-56">
              <span className="sr-only">{m.home.searchPlaceholder}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={m.home.searchPlaceholder}
                className="min-h-11 w-full rounded-md border border-white/15 bg-kestrel-raised pl-9 pr-3 text-sm placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-sky-300" />
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <span>{m.home.sort}</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as ProjectSort)}
                className="min-h-11 rounded-md border border-white/15 bg-kestrel-raised px-2 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300">
                <option value="edited">{m.home.sortEdited}</option>
                <option value="created">{m.home.sortCreated}</option>
                <option value="name">{m.home.sortName}</option>
              </select>
            </label>
          </div>
        )}
        <div data-project-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
        <LanguageWelcome />
        {creating && <NewProjectWizard loading={loading} onCancel={() => setCreating(false)} onCreate={onCreate} />}
        {error && <p role="alert" className="mb-3 text-sm text-orange-200">{error}</p>}
        {loading && <p role="status" className="mb-3 text-sm text-zinc-400">{m.home.opening}</p>}
        {!loading && !error && !splitProjects(projects).active.length && !splitProjects(projects).archived.length && !creating && (
          <p className="rounded-xl border border-white/10 bg-kestrel-raised p-4 text-sm text-zinc-300">
            {m.home.empty}
          </p>
        )}
        {(() => {
          const { active: allActive, archived: allArchived } = splitProjects(projects);
          const active = filterProjects(inboxFirst(sortProjects(allActive, sort)), query, photoText);
          const archived = filterProjects(sortProjects(allArchived, sort), query, photoText);
          const action = 'grid h-11 w-11 shrink-0 max-sm:hidden place-items-center rounded-md text-zinc-300 hover:bg-white/10 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-45';
          const row = ({ project, viaPhotos }: { project: ShootDescriptor; viaPhotos: boolean }, isArchived: boolean) => (
            <SwipeRow key={project.id} archived={isArchived} title={project.title} disabled={loading}
              onArchive={() => (isArchived ? onUnarchive(project.id) : onArchive(project))} onDelete={() => onDelete(project)}>
              <button type="button" disabled={loading} onClick={() => onOpen(project.id)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-3 text-left hover:bg-white/6 disabled:opacity-55">
                <Folder className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{project.title}{project.inbox && <span className="ml-2 rounded bg-sky-300/15 px-1.5 py-0.5 text-xs font-normal text-sky-100">{t.list.quickEdits}</span>}</span>
                  <span className="block text-xs text-zinc-400">{t.list.photoCount(project.totalFrames)}{viaPhotos && ` · ${t.list.matchesInside}`}</span>
                  <span className="block text-xs text-zinc-400">
                    {t.list.created} <time dateTime={project.createdAt ? new Date(project.createdAt).toISOString() : undefined}>{formatProjectDate(project.createdAt)}</time>
                    {' · '}{t.list.lastEdited} <time dateTime={project.lastUpdatedAt ? new Date(project.lastUpdatedAt).toISOString() : undefined}>{formatProjectDate(project.lastUpdatedAt, true)}</time>
                    {isArchived && project.archivedAt ? <>{' · '}{t.list.archivedOn(formatProjectDate(project.archivedAt))}</> : null}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
              </button>
              {isArchived ? (
                <button type="button" disabled={loading} className={action} aria-label={t.list.restoreFromArchive(project.title)} title={t.list.restore} onClick={() => onUnarchive(project.id)}>
                  <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : (
                <button type="button" disabled={loading} className={action} aria-label={t.list.archiveNamed(project.title)} title={t.list.archive} onClick={() => onArchive(project)}>
                  <Archive className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              <button type="button" disabled={loading} className={action} aria-label={t.list.deleteNamed(project.title)} title={t.list.delete} onClick={() => onDelete(project)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </SwipeRow>
          );
          return <>
            {query.trim() && !active.length && !archived.length && <p role="status" className="rounded-xl border border-white/10 bg-kestrel-raised p-4 text-sm text-zinc-300">{t.list.noMatch(query.trim())}</p>}
            {active.length > 0 && <ul className="divide-y divide-white/8 rounded-xl border border-white/10 bg-kestrel-raised">{active.map((hit) => row(hit, false))}</ul>}
            {archived.length > 0 && (
              <details className="mt-4 rounded-xl border border-white/10 bg-kestrel-raised">
                <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm text-zinc-300">{t.list.archivedCount(archived.length)}</summary>
                <ul className="divide-y divide-white/8 border-t border-white/10">{archived.map((hit) => row(hit, true))}</ul>
              </details>
            )}
          </>;
        })()}
        {projects.length > 0 && <CatalogueStorage />}
        </div>
        <footer aria-label={m.home.aboutTitle} data-about-bar className="shrink-0 border-t border-white/10 bg-kestrel-panel text-xs leading-relaxed text-zinc-400"
          onTouchStart={(event) => { aboutTouchY.current = event.touches[0]?.clientY ?? null; }}
          onTouchEnd={(event) => {
            const start = aboutTouchY.current; aboutTouchY.current = null;
            const end = event.changedTouches[0]?.clientY;
            if (start === null || end === undefined) return;
            if (start - end > 30) setAboutOpen(true); else if (end - start > 30) setAboutOpen(false);
          }}>
          <button type="button" aria-expanded={aboutOpen} onClick={() => setAboutOpen(value => !value)}
            className="flex min-h-11 w-full items-center justify-between gap-2 px-1 text-left font-medium text-zinc-300 focus-visible:outline-2 focus-visible:outline-sky-300">
            <span>{m.home.aboutTitle}</span>
            <ChevronRight className={`h-4 w-4 transition-transform ${aboutOpen ? '-rotate-90' : 'rotate-90'}`} aria-hidden="true" />
          </button>
          {aboutOpen && (
            <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-1 pb-3">
              <p className="min-w-0 max-w-lg">{m.home.about}</p>
              <div className="flex shrink-0 items-center gap-3">
                <button type="button" onClick={() => setLicenceOpen(true)} className="min-h-11 rounded-md px-2 text-zinc-300 underline hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300">{m.home.licence}</button>
                <p className="font-mono" aria-label={t.list.versionLabel(appVersion)}>{m.home.version(appVersion)}</p>
              </div>
            </div>
          )}
        </footer>
      </div>
      {appearanceOpen && <AppearanceDialog side={editPanelSide} onSideChange={onEditPanelSideChange} onOpenMacroPad={onOpenMacroPad} onClose={() => setAppearanceOpen(false)} />}
      {licenceOpen && <LicenceAndSettings onClose={() => setLicenceOpen(false)} />}
    </main>
  );
}
