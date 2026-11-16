import { useEffect, useRef, useState } from 'react';
import { ago } from '../core/autoBackup';
import { choosable, HEALTH_TEXT, ROLE_LABEL, type Role } from '../core/connections';
import type { CullingState } from '../core/types';
import { backUpProjectNow, useBackupStatus } from '../providers/autoBackup';
import { useConnections } from '../providers/connectionStore';
import { setLocations, useProjectLocations } from '../providers/projectLocations';
import { focusBeforeOpening, returnFocus } from './focusReturn';

const action = 'min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-sky-300';
const field = 'block min-h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm text-zinc-100';

const ROLES: { role: Role; hint: string }[] = [
  { role: 'loadFrom', hint: 'Where Bring changes looks for this project.' },
  { role: 'saveTo', hint: 'Where Send puts this project’s decisions and edits.' },
  { role: 'backUpTo', hint: 'Backed up automatically after you make changes, keeping the newest ten.' },
  { role: 'exportTo', hint: 'When you export, you can also save copies into an "export" folder here, such as on the drive your originals are on. Each save gets its own dated folder and nothing is overwritten.' },
];

/** Choose, for one project, where it loads from, saves to and backs up to, and see whether the backup is working. */
export function ProjectLocationsDialog({ state, onClose }: { state: CullingState; onClose: () => void }) {
  const projectId = state.shoot.id;
  const { list, reports } = useConnections();
  const locations = useProjectLocations(projectId);
  const status = useBackupStatus(projectId);
  const [now, setNow] = useState(Date.now());
  const previous = useRef<HTMLElement | null>(focusBeforeOpening());
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const keep = previous.current;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', close, true);
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => { document.removeEventListener('keydown', close, true); window.clearInterval(tick); returnFocus(keep); };
  }, [onClose]);

  const options = choosable(list, reports);
  const backupTarget = list.find((connection) => connection.id === locations.backUpTo);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="locations-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-white/12 bg-kestrel-panel shadow-2xl">
        <header className="shrink-0 border-b border-white/10 px-5 py-4">
          <h2 id="locations-title" ref={heading} tabIndex={-1} className="text-base font-semibold text-zinc-100 focus:outline-none">Where “{state.shoot.title}” is kept</h2>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm text-zinc-300">
          {list.length === 0 && <p role="note" className="rounded-md border border-white/10 bg-black/20 px-3 py-2">No connections yet. Add a folder or your own cloud storage under <strong>Where my work is kept</strong> on the home page, then choose it here. Until then this project lives on this device only.</p>}
          {ROLES.map(({ role, hint }) => (
            <label key={role} className="block">
              <span className="font-medium text-zinc-100">{ROLE_LABEL[role]}</span>
              <select className={`${field} mt-1`} value={locations[role] ?? ''} onChange={(event) => setLocations(projectId, { ...locations, [role]: event.target.value || undefined })} disabled={list.length === 0}>
                <option value="">This device only</option>
                {options.map((connection) => {
                  const health = reports[connection.id]?.health;
                  return <option key={connection.id} value={connection.id}>{connection.label}{health && health !== 'ok' ? ` (${HEALTH_TEXT[health].word})` : ''}</option>;
                })}
              </select>
              <span className="mt-0.5 block text-xs text-zinc-400">{hint}</span>
            </label>
          ))}
          <div className="space-y-2 border-t border-white/10 pt-3" aria-live="polite">
            <p className="font-medium text-zinc-100">Backup</p>
            {!backupTarget && <p>Not set up. Choose “Back up to” above and Kestrel backs this project up on its own.</p>}
            {backupTarget && status.state === 'working' && <p role="status">Backing up to {backupTarget.label}…</p>}
            {backupTarget && status.state === 'ok' && <p role="status">Last backed up {ago(status.at ?? now, now)} to {backupTarget.label}.</p>}
            {backupTarget && status.state === 'failed' && <p role="alert" className="text-amber-200">The last backup to {backupTarget.label} did not work: {status.message} Your work is safe on this device, and Kestrel will try again.</p>}
            {backupTarget && status.state === 'idle' && <p role="status">Will back up to {backupTarget.label} after your next change.</p>}
            <button type="button" className={action} disabled={!backupTarget || status.state === 'working'} onClick={() => void backUpProjectNow(state)}>Back up now</button>
          </div>
        </div>
        <footer className="shrink-0 border-t border-white/10 px-5 py-3"><button type="button" onClick={onClose} className={`${action} w-full`}>Close</button></footer>
      </div>
    </div>
  );
}
