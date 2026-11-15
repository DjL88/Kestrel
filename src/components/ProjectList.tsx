import { useRef, useState } from 'react';
import { Archive, ArchiveRestore, ChevronRight, Folder, FolderUp, Plus, SquareChevronsRight, Trash2 } from 'lucide-react';
import kestrelMark from '../assets/kestrel-mark.svg';
import type { ShootDescriptor } from '../core/types';
import { NewProjectWizard } from './NewProjectWizard';
import type { ProjectSettings } from '../core/projectSettings';
import { inboxFirst, splitProjects } from '../core/projects';
import { formatProjectDate } from '../core/formatDate';

interface Props {
  projects: ShootDescriptor[];
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

export function ProjectList({ projects, loading, error, onOpen, onCreate, onRestore, onArchive, onUnarchive, onDelete, onQuickEdit }: Props) {
  const [creating, setCreating] = useState(false);
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
          <div className="flex items-center gap-2">
          <input ref={backupInput} type="file" accept=".json,application/json" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onRestore(file);
          }} />
          <button type="button" onClick={() => backupInput.current?.click()} disabled={loading}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-zinc-300 hover:bg-white/8">
            <FolderUp className="h-4 w-4" aria-hidden="true" /> Restore backup
          </button>
          <input ref={quickInput} type="file" accept=".jpg,.jpeg,.png,.webp,.nef,image/jpeg,image/png,image/webp" multiple hidden data-testid="quick-edit-input" onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            if (files.length) onQuickEdit(files);
          }} />
          <button type="button" onClick={() => quickInput.current?.click()} disabled={loading} title="Open a photo straight into the editor, without making a project"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-sky-300/50 px-3 text-sm text-sky-100 hover:bg-sky-300/15 disabled:opacity-50">
            <SquareChevronsRight className="h-4 w-4" aria-hidden="true" /> Quick edit
          </button>
          <button type="button" onClick={() => setCreating(!creating)} disabled={loading}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-kestrel-copper hover:bg-kestrel-copper-hover! px-3 text-sm font-semibold text-zinc-950 disabled:opacity-50">
            <Plus className="h-4 w-4" aria-hidden="true" /> New project
          </button>
          </div>
        </header>
        {creating && <NewProjectWizard loading={loading} onCancel={() => setCreating(false)} onCreate={onCreate} />}
        {error && <p role="alert" className="mb-3 text-sm text-orange-200">{error}</p>}
        {loading && <p role="status" className="mb-3 text-sm text-zinc-400">Opening catalogue…</p>}
        {!loading && !error && !splitProjects(projects).active.length && !splitProjects(projects).archived.length && !creating && (
          <p className="rounded-xl border border-white/10 bg-kestrel-raised p-4 text-sm text-zinc-300">
            Create a project to import photos, or restore a Kestrel backup.
          </p>
        )}
        {(() => {
          const { active, archived } = splitProjects(projects);
          const action = 'grid h-11 w-11 shrink-0 place-items-center rounded-md text-zinc-300 hover:bg-white/10 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-45';
          const row = (project: ShootDescriptor, isArchived: boolean) => (
            <li key={project.id} className="flex items-center gap-1 pr-1">
              <button type="button" disabled={loading} onClick={() => onOpen(project.id)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-3 text-left hover:bg-white/6 disabled:opacity-55">
                <Folder className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{project.title}{project.inbox && <span className="ml-2 rounded bg-sky-300/15 px-1.5 py-0.5 text-xs font-normal text-sky-100">Quick edits</span>}</span>
                  <span className="block text-xs text-zinc-400">{project.totalFrames} {project.totalFrames === 1 ? 'photo' : 'photos'}</span>
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
            </li>
          );
          return <>
            {active.length > 0 && <ul className="divide-y divide-white/8 rounded-xl border border-white/10 bg-kestrel-raised">{inboxFirst(active).map((project) => row(project, false))}</ul>}
            {archived.length > 0 && (
              <details className="mt-4 rounded-xl border border-white/10 bg-kestrel-raised">
                <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm text-zinc-300">Archived ({archived.length})</summary>
                <ul className="divide-y divide-white/8 border-t border-white/10">{archived.map((project) => row(project, true))}</ul>
              </details>
            )}
          </>;
        })()}
      </div>
    </main>
  );
}
