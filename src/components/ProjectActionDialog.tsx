import { useState } from 'react';
import { Download } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
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
    <ConfirmDialog title={deleting ? `Delete “${project.title}”?` : `Archive “${project.title}”?`}
      confirmLabel={deleting ? 'Delete project permanently' : 'Archive project'} cancelLabel={deleting ? 'Keep project' : 'Cancel'}
      confirmDisabled={(deleting && !understood) || backup === 'working'} onConfirm={onConfirm} onCancel={onCancel}>
      {deleting ? (
        <>
          <p>This removes the project’s choices, edits, masks and crops from this browser, along with the photo copies Kestrel stored for it. <strong>It cannot be undone</strong> unless you have a backup.</p>
          <p>Your original files on your computer are not deleted.</p>
        </>
      ) : (
        <p>The project is hidden from your list. Nothing is deleted, and you can restore it from Archived whenever you like.</p>
      )}
      <div className="rounded-lg border border-white/10 p-3">
        <p className="mb-2">{deleting ? 'Save a backup first?' : 'Want a backup as well?'} It holds your decisions, ratings, edits and masks, but not the photos themselves.</p>
        <button type="button" onClick={() => void backUp()} disabled={backup === 'working'}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-white/20 px-3 text-sm font-semibold hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-sky-300 disabled:opacity-45">
          <Download className="h-4 w-4" aria-hidden="true" />{backup === 'working' ? 'Saving…' : 'Back up this project'}
        </button>
        <p role="status" className="mt-2 min-h-4 text-xs">
          {backup === 'done' && 'Backup saved. Restore it from the Projects page whenever you need it.'}
          {backup === 'cancelled' && 'No backup was saved.'}
          {backup === 'failed' && 'The backup could not be made. Try again before you continue.'}
          {backup === 'none' && deleting && 'No backup has been made yet.'}
        </p>
      </div>
      {deleting && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="h-5 w-5" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
          I understand this cannot be undone
        </label>
      )}
    </ConfirmDialog>
  );
}
