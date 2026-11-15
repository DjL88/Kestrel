import { useState } from 'react';
import { ChevronRight, Folder, Plus } from 'lucide-react';
import type { ShootDescriptor } from '../core/types';

interface Props {
  projects: ShootDescriptor[];
  loading: boolean;
  error?: string;
  onOpen: (id: string) => void;
  onCreate: (name: string) => void;
}

export function ProjectList({ projects, loading, error, onOpen, onCreate }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  return (
    <main className="h-dvh overflow-auto bg-[#101114] px-4 text-zinc-100 sm:px-8">
      <div className="mx-auto max-w-3xl py-8 sm:py-14">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <button type="button" onClick={() => setCreating(!creating)} disabled={loading}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-sky-200 px-3 text-sm font-semibold text-zinc-950 disabled:opacity-50">
            <Plus className="h-4 w-4" aria-hidden="true" /> New project
          </button>
        </header>
        {creating && (
          <form className="mb-4 rounded-xl border border-white/10 bg-[#181A1F] p-3" onSubmit={(event) => {
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
              <button type="submit" disabled={!name.trim() || loading} className="min-h-11 rounded-md bg-sky-200 px-3 text-sm font-semibold text-zinc-950 disabled:opacity-40">Create project</button>
            </div>
          </form>
        )}
        {error && <p role="alert" className="mb-3 text-sm text-orange-200">{error}</p>}
        {loading && <p role="status" className="mb-3 text-sm text-zinc-400">Opening catalogue…</p>}
        <ul className="divide-y divide-white/8 rounded-xl border border-white/10 bg-[#181A1F]">
          {projects.map((project) => (
            <li key={project.id}>
              <button type="button" disabled={loading} onClick={() => onOpen(project.id)}
                className="flex w-full items-center gap-3 rounded-md p-3 text-left hover:bg-white/6 disabled:opacity-55">
                <Folder className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{project.title}</span>
                  <span className="block text-xs text-zinc-400">{project.totalFrames} {project.totalFrames === 1 ? 'photo' : 'photos'}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
