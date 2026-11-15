import { useRef, useState } from 'react';
import { Archive, ArchiveRestore, ChevronRight, Folder, FolderUp, Plus, Search, SquareChevronsRight, Trash2 } from 'lucide-react';
import kestrelMark from '../assets/kestrel-mark.svg';
import type { ShootDescriptor } from '../core/types';
import { NewProjectWizard } from './NewProjectWizard';
import type { ProjectSettings } from '../core/projectSettings';
import { filterProjects, inboxFirst, sortProjects, splitProjects, type ProjectSort } from '../core/projects';
import { formatProjectDate } from '../core/formatDate';

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
}

const ACTION = 76;

/**
 * A project row that, for a finger only, slides left to reveal Archive, and further to reveal Delete.
 * A mouse or pen never slides it: desktop keeps its visible buttons, and nothing moves by accident.
 */
function SwipeRow({ children, archived, title, onArchive, onDelete, disabled }: {
  children: React.ReactNode; archived: boolean; title: string; onArchive: () => void; onDelete: () => void; disabled: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; from: number; moved: boolean } | null>(null);
  const open = offset <= -ACTION / 2;
  const settle = (value: number) => (value < -ACTION * 1.6 ? -ACTION * 2 : value < -ACTION * 0.5 ? -ACTION : 0);
  const back = () => setOffset(0);
  return (
    <li className="relative overflow-hidden">
      <div className="absolute inset-y-0 right-0 flex" inert={!open} aria-hidden={!open}>
        <button type="button" tabIndex={open ? 0 : -1} disabled={disabled} onClick={() => { back(); onArchive(); }} aria-label={`${archived ? 'Restore' : 'Archive'} ${title}`}
          className="grid w-[76px] place-items-center bg-sky-900 text-xs font-medium text-white">
          {archived ? <ArchiveRestore className="mx-auto h-5 w-5" aria-hidden="true" /> : <Archive className="mx-auto h-5 w-5" aria-hidden="true" />}
          {archived ? 'Restore' : 'Archive'}
        </button>
        <button type="button" tabIndex={offset <= -ACTION * 1.5 ? 0 : -1} disabled={disabled} onClick={() => { back(); onDelete(); }} aria-label={`Delete ${title}`}
          className="grid w-[76px] place-items-center bg-red-900 text-xs font-medium text-white">
          <Trash2 className="mx-auto h-5 w-5" aria-hidden="true" />Delete
        </button>
      </div>
      <div data-testid="swipe-row" className="relative flex touch-pan-y items-center gap-1 bg-kestrel-raised pr-1"
        style={{ transform: `translateX(${offset}px)`, transition: dragging ? 'none' : 'transform 160ms ease-out' }}
        onPointerDown={(event) => {
          if (event.pointerType !== 'touch' || !event.isPrimary) return;
          start.current = { x: event.clientX, y: event.clientY, from: offset, moved: false };
        }}
        onPointerMove={(event) => {
          const s0 = start.current;
          if (!s0 || event.pointerType !== 'touch') return;
          const dx = event.clientX - s0.x, dy = event.clientY - s0.y;
          if (!s0.moved && (Math.abs(dx) < 8 || Math.abs(dy) > Math.abs(dx))) return;
          s0.moved = true;
          setDragging(true);
          setOffset(Math.max(-ACTION * 2, Math.min(0, s0.from + dx)));
        }}
        onPointerUp={() => { const s0 = start.current; start.current = null; setDragging(false); if (s0?.moved) setOffset((value) => settle(value)); }}
        onPointerCancel={() => { start.current = null; setDragging(false); setOffset((value) => settle(value)); }}
        onClickCapture={(event) => { if (offset !== 0) { event.preventDefault(); event.stopPropagation(); back(); } }}>
        {children}
      </div>
    </li>
  );
}

export function ProjectList({ projects, photoText = {}, loading, error, onOpen, onCreate, onRestore, onArchive, onUnarchive, onDelete, onQuickEdit }: Props) {
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ProjectSort>('edited');
  const backupInput = useRef<HTMLInputElement>(null);
  const quickInput = useRef<HTMLInputElement>(null);
  return (
    <main className="h-dvh overflow-auto bg-kestrel-canvas px-4 text-zinc-100 sm:px-8">
      <div className="mx-auto max-w-3xl py-8 sm:py-14">
        <div className="mb-7 flex items-center gap-2.5">
          <img src={kestrelMark} alt="" className="h-10 w-10" />
          <span className="text-lg font-semibold tracking-tight text-kestrel-ink">Kestrel</span>
        </div>
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto">
          <input ref={backupInput} type="file" accept=".json,application/json" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onRestore(file);
          }} />
          <button type="button" onClick={() => backupInput.current?.click()} disabled={loading}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-zinc-300 hover:bg-white/8 max-sm:hidden">
            <FolderUp className="h-4 w-4" aria-hidden="true" /> Restore backup
          </button>
          <input ref={quickInput} type="file" accept=".jpg,.jpeg,.png,.webp,.nef,image/jpeg,image/png,image/webp" multiple hidden data-testid="quick-edit-input" onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            if (files.length) onQuickEdit(files);
          }} />
          <button type="button" onClick={() => quickInput.current?.click()} disabled={loading} title="Open a photo straight into the editor, without making a project"
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-sky-300/50 px-3 text-sm text-sky-100 hover:bg-sky-300/15 disabled:opacity-50">
            <SquareChevronsRight className="h-4 w-4" aria-hidden="true" /> Quick edit
          </button>
          <button type="button" onClick={() => setCreating(!creating)} disabled={loading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-kestrel-copper hover:bg-kestrel-copper-hover! px-3 text-sm font-semibold text-zinc-950 disabled:opacity-50">
            <Plus className="h-4 w-4" aria-hidden="true" /> New project
          </button>
          </div>
        </header>
        <p className="-mt-3 mb-5 text-center sm:hidden">
          <button type="button" onClick={() => backupInput.current?.click()} disabled={loading} className="min-h-11 px-3 text-sm text-zinc-300 underline underline-offset-4 hover:text-white">
            Restore backup
          </button>
        </p>
        {projects.length > 1 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1 basis-56">
              <span className="sr-only">Search projects and photos</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects and photos"
                className="min-h-11 w-full rounded-md border border-white/15 bg-kestrel-raised pl-9 pr-3 text-sm placeholder:text-zinc-500 focus-visible:outline-2 focus-visible:outline-sky-300" />
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <span>Sort</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as ProjectSort)}
                className="min-h-11 rounded-md border border-white/15 bg-kestrel-raised px-2 text-sm text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300">
                <option value="edited">Last edited</option>
                <option value="created">Newest created</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
        )}
        {creating && <NewProjectWizard loading={loading} onCancel={() => setCreating(false)} onCreate={onCreate} />}
        {error && <p role="alert" className="mb-3 text-sm text-orange-200">{error}</p>}
        {loading && <p role="status" className="mb-3 text-sm text-zinc-400">Opening catalogue…</p>}
        {!loading && !error && !splitProjects(projects).active.length && !splitProjects(projects).archived.length && !creating && (
          <p className="rounded-xl border border-white/10 bg-kestrel-raised p-4 text-sm text-zinc-300">
            Create a project to import photos, or restore a Kestrel backup.
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
                  <span className="block truncate text-sm font-medium">{project.title}{project.inbox && <span className="ml-2 rounded bg-sky-300/15 px-1.5 py-0.5 text-xs font-normal text-sky-100">Quick edits</span>}</span>
                  <span className="block text-xs text-zinc-400">{project.totalFrames} {project.totalFrames === 1 ? 'photo' : 'photos'}{viaPhotos && ' · matches photos inside'}</span>
                  <span className="block text-xs text-zinc-400">
                    Created <time dateTime={project.createdAt ? new Date(project.createdAt).toISOString() : undefined}>{formatProjectDate(project.createdAt)}</time>
                    {' · '}Last edited <time dateTime={project.lastUpdatedAt ? new Date(project.lastUpdatedAt).toISOString() : undefined}>{formatProjectDate(project.lastUpdatedAt, true)}</time>
                    {isArchived && project.archivedAt ? <>{' · '}Archived {formatProjectDate(project.archivedAt)}</> : null}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
              </button>
              {isArchived ? (
                <button type="button" disabled={loading} className={action} aria-label={`Restore ${project.title} from the archive`} title="Restore" onClick={() => onUnarchive(project.id)}>
                  <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : (
                <button type="button" disabled={loading} className={action} aria-label={`Archive ${project.title}`} title="Archive" onClick={() => onArchive(project)}>
                  <Archive className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              <button type="button" disabled={loading} className={action} aria-label={`Delete ${project.title}`} title="Delete" onClick={() => onDelete(project)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </SwipeRow>
          );
          return <>
            {query.trim() && !active.length && !archived.length && <p role="status" className="rounded-xl border border-white/10 bg-kestrel-raised p-4 text-sm text-zinc-300">No projects or photos match “{query.trim()}”.</p>}
            {active.length > 0 && <ul className="divide-y divide-white/8 rounded-xl border border-white/10 bg-kestrel-raised">{active.map((hit) => row(hit, false))}</ul>}
            {archived.length > 0 && (
              <details className="mt-4 rounded-xl border border-white/10 bg-kestrel-raised">
                <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm text-zinc-300">Archived ({archived.length})</summary>
                <ul className="divide-y divide-white/8 border-t border-white/10">{archived.map((hit) => row(hit, true))}</ul>
              </details>
            )}
          </>;
        })()}
      </div>
    </main>
  );
}
