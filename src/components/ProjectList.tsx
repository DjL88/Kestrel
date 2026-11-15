import { useRef, useState } from 'react';
import { ChevronRight, Folder, FolderUp, Plus } from 'lucide-react';
import kestrelMark from '../assets/kestrel-mark.svg';
import type { ShootDescriptor } from '../core/types';
import { formatProjectDate } from '../core/formatDate';

interface Props {
  projects: ShootDescriptor[];
  loading: boolean;
  error?: string;
  onOpen: (id: string) => void;
  onCreate: (name: string) => void;
  onRestore: (file: File) => void;
}

export function ProjectList({ projects, loading, error, onOpen, onCreate, onRestore }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const backupInput = useRef<HTMLInputElement>(null);
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
          <button type="button" onClick={() => setCreating(!creating)} disabled={loading}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-kestrel-copper px-3 text-sm font-semibold text-zinc-950 disabled:opacity-50">
            <Plus className="h-4 w-4" aria-hidden="true" /> New project
          </button>
          </div>
        </header>
        {creating && (
          <form className="mb-4 rounded-xl border border-white/10 bg-kestrel-raised p-3" onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) onCreate(name.trim());
          }}>
            <label className="block text-sm">
              Project name
              <input autoFocus value={name} maxLength={100} onChange={(event) => setName(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-lg border border-white/15 bg-black/20 px-3" />
            </label>
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="min-h-11 rounded-md px-3 text-sm hover:bg-white/8">Cancel</button>
              <button type="submit" disabled={!name.trim() || loading} className="min-h-11 rounded-md bg-kestrel-copper px-3 text-sm font-semibold text-zinc-950 disabled:opacity-40">Create project</button>
            </div>
          </form>
        )}
        {error && <p role="alert" className="mb-3 text-sm text-orange-200">{error}</p>}
        {loading && <p role="status" className="mb-3 text-sm text-zinc-400">Opening catalogue…</p>}
        {!loading && !error && !projects.length && !creating && (
          <p className="rounded-xl border border-white/10 bg-kestrel-raised p-4 text-sm text-zinc-300">
            Create a project to import photos, or restore a Kestrel backup.
          </p>
        )}
        {projects.length > 0 && (
          <ul className="divide-y divide-white/8 rounded-xl border border-white/10 bg-kestrel-raised">
            {projects.map((project) => (
              <li key={project.id}>
                <button type="button" disabled={loading} onClick={() => onOpen(project.id)}
                  className="flex w-full items-center gap-3 rounded-md p-3 text-left hover:bg-white/6 disabled:opacity-55">
                  <Folder className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{project.title}</span>
                    <span className="block text-xs text-zinc-400">{project.totalFrames} {project.totalFrames === 1 ? 'photo' : 'photos'}</span>
                    <span className="block text-xs text-zinc-400">
                      Created <time dateTime={project.createdAt ? new Date(project.createdAt).toISOString() : undefined}>{formatProjectDate(project.createdAt)}</time>
                      {' · '}Last edited <time dateTime={project.lastUpdatedAt ? new Date(project.lastUpdatedAt).toISOString() : undefined}>{formatProjectDate(project.lastUpdatedAt, true)}</time>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
