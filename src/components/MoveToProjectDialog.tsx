import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { projectsText as t } from '../i18n/areas/projects';
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
    <ConfirmDialog title={t.move.title(count)} confirmLabel={t.move.confirm} cancelLabel={t.common.cancel}
      confirmDisabled={!target} onConfirm={() => onConfirm(target)} onCancel={onCancel}>
      {projects.length === 0 ? (
        <p>{t.move.noOther}</p>
      ) : (
        <label className="block text-sm">
          {t.move.moveTo}
          <select value={target} onChange={(event) => setTarget(event.target.value)} aria-label={t.move.destination}
            className="mt-1 min-h-11 w-full rounded-md border border-white/15 bg-kestrel-panel px-2 text-zinc-100">
            <option value="">{t.move.choose}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.title} ({project.totalFrames})</option>)}
          </select>
        </label>
      )}
      <p>{t.move.note}</p>
    </ConfirmDialog>
  );
}
