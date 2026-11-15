import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import type { ShootDescriptor } from '../core/types';

interface Props {
  count: number;
  projects: ShootDescriptor[];
  onConfirm: (projectId: string) => void;
  onCancel: () => void;
}

export function MoveToProjectDialog({ count, projects, onConfirm, onCancel }: Props) {
  const [target, setTarget] = useState('');
  return (
    <ConfirmDialog title={`Move ${count === 1 ? 'this photo' : `${count} photos`} to a project`} confirmLabel="Move photos" cancelLabel="Cancel"
      confirmDisabled={!target} onConfirm={() => onConfirm(target)} onCancel={onCancel}>
      {projects.length === 0 ? (
        <p>There is no other project to move to yet. Create one from the Projects page first.</p>
      ) : (
        <label className="block text-sm">
          Move to
          <select value={target} onChange={(event) => setTarget(event.target.value)} aria-label="Destination project"
            className="mt-1 min-h-11 w-full rounded-md border border-white/15 bg-kestrel-panel px-2 text-zinc-100">
            <option value="">Choose a project…</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.title} ({project.totalFrames})</option>)}
          </select>
        </label>
      )}
      <p>Their choices, edits, masks and crops go with them. A photo that is already in that project stays here. Your original files are not touched.</p>
    </ConfirmDialog>
  );
}
