import { useState } from 'react';
import { Download } from './icons/KestrelUIIcons';
import { ConfirmDialog } from './ConfirmDialog';
import { projectsText as t } from '../i18n/areas/projects';
import type { ShootDescriptor } from '../core/types';

interface Props {
  kind: 'archive' | 'delete';
  project: ShootDescriptor;
  /** Saves a backup of the project. Resolves to what happened so the dialog can say so. */
  onBackup: () => Promise<'saved' | 'downloaded' | 'cancelled'>;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Offers a backup first, then asks. Deleting also needs a tick, so it cannot happen by a stray key press. */
export function ProjectActionDialog({ kind, project, onBackup, onConfirm, onCancel }: Props) {
  const [backup, setBackup] = useState<'none' | 'working' | 'done' | 'cancelled' | 'failed'>('none');
  const [understood, setUnderstood] = useState(false);
  const deleting = kind === 'delete';

  async function backUp() {
    setBackup('working');
    try {
      setBackup((await onBackup()) === 'cancelled' ? 'cancelled' : 'done');
    } catch {
      setBackup('failed');
    }
  }

  return (
    <ConfirmDialog title={deleting ? t.projectAction.deleteTitle(project.title) : t.projectAction.archiveTitle(project.title)}
      confirmLabel={deleting ? t.projectAction.deleteConfirm : t.projectAction.archiveConfirm} cancelLabel={deleting ? t.projectAction.keepProject : t.common.cancel}
      confirmDisabled={(deleting && !understood) || backup === 'working'} onConfirm={onConfirm} onCancel={onCancel}>
      {deleting ? (
        <>
          <p>{t.projectAction.deleteBodyStart}<strong>{t.projectAction.deleteBodyStrong}</strong>{t.projectAction.deleteBodyEnd}</p>
          <p>{t.projectAction.originalsSafe}</p>
        </>
      ) : (
        <p>{t.projectAction.archiveBody}</p>
      )}
      <div className="rounded-lg border border-white/10 p-3">
        <p className="mb-2">{deleting ? t.projectAction.backupQuestionDelete : t.projectAction.backupQuestionArchive}</p>
        <button type="button" onClick={() => void backUp()} disabled={backup === 'working'}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-white/20 px-3 text-sm font-semibold hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-45">
          <Download className="h-4 w-4" aria-hidden="true" />{backup === 'working' ? t.projectAction.saving : t.projectAction.backUp}
        </button>
        <p role="status" className="mt-2 min-h-4 text-xs">
          {backup === 'done' && t.projectAction.backupDone}
          {backup === 'cancelled' && t.projectAction.backupCancelled}
          {backup === 'failed' && t.projectAction.backupFailed}
          {backup === 'none' && deleting && t.projectAction.backupNone}
        </p>
      </div>
      {deleting && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
          {t.projectAction.understand}
        </label>
      )}
    </ConfirmDialog>
  );
}
