import { useEffect, useRef, useState } from 'react';
import { choosable, type Role } from '../core/connections';
import { projectsText as t } from '../i18n/areas/projects';
import type { CullingState } from '../core/types';
import { backUpProjectNow, useBackupStatus } from '../providers/autoBackup';
import { useConnections } from '../providers/connectionStore';
import { setLocations, useProjectLocations } from '../providers/projectLocations';
import { focusBeforeOpening, returnFocus } from './focusReturn';

const action = 'min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-sky-300';
const field = 'block min-h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm text-zinc-100';

const ROLES: Role[] = ['loadFrom', 'saveTo', 'backUpTo', 'exportTo'];

/** How long ago, in words: the same steps as `ago` in core/autoBackup, in the session language. */
function ago(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return t.locations.justNow;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t.locations.minutesAgo(minutes);
  const hours = Math.round(minutes / 60);
  return hours < 48 ? t.locations.hoursAgo(hours) : t.locations.daysAgo(Math.round(hours / 24));
}

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
  const backupLabel = backupTarget?.label ?? (status.to === 'Photo folder' || status.to === 'Photo source'
    ? t.locations.photoFolder : t.locations.thisDeviceOnly);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="locations-title" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4"
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const order = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')];
        if (!order.length) return;
        const at = order.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        order[(at + (event.shiftKey ? order.length - 1 : 1)) % order.length]?.focus();
      }}>
      <div className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-white/12 bg-kestrel-panel shadow-2xl">
        <header className="shrink-0 border-b border-white/10 px-5 py-4">
          <h2 id="locations-title" ref={heading} tabIndex={-1} className="text-base font-semibold text-zinc-100 focus:outline-none">{t.locations.title(state.shoot.title)}</h2>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm text-zinc-300">
          {list.length === 0 && <p role="note" className="rounded-md border border-white/10 bg-black/20 px-3 py-2">{t.locations.autoRecoveryNote}</p>}
          {ROLES.map((role) => (
            <label key={role} className="block">
              <span className="font-medium text-zinc-100">{t.locations.role[role]}</span>
              <select className={`${field} mt-1`} value={locations[role] ?? ''} onChange={(event) => setLocations(projectId, { ...locations, [role]: event.target.value || undefined })} disabled={list.length === 0}>
                <option value="">{role === 'backUpTo' ? t.locations.autoRecoveryName : t.locations.thisDeviceOnly}</option>
                {options.map((connection) => {
                  const health = reports[connection.id]?.health;
                  return <option key={connection.id} value={connection.id}>{connection.label}{health && health !== 'ok' ? ` (${t.connections.health[health]})` : ''}</option>;
                })}
              </select>
              <span className="mt-0.5 block text-xs text-zinc-400">{t.locations.roleHint[role]}</span>
            </label>
          ))}
          <div className="space-y-2 border-t border-white/10 pt-3" aria-live="polite">
            <p className="font-medium text-zinc-100">{t.locations.backup}</p>
            {!backupTarget && <p>{t.locations.autoRecoveryNote}</p>}
            {status.state === 'working' && <p role="status">{t.locations.backingUp(backupLabel)}</p>}
            {status.state === 'ok' && <p role="status">{t.locations.lastBackedUp(ago(status.at ?? now, now), backupLabel)}</p>}
            {status.state === 'ok' && status.message && <p role="status" className="text-amber-200">{status.message}</p>}
            {status.state === 'partial' && <p role="status" className="text-zinc-300">{status.message}</p>}
            {status.state === 'failed' && <p role="status" className="text-zinc-400">{t.locations.backupFailed(backupLabel, status.message ?? '')}</p>}
            {status.state === 'idle' && <p role="status">{t.locations.backupIdle(backupLabel)}</p>}
            <button type="button" className={action} disabled={status.state === 'working'} onClick={() => void backUpProjectNow(state)}>{t.locations.backUpNow}</button>
          </div>
        </div>
        <footer className="shrink-0 border-t border-white/10 px-5 py-3"><button type="button" onClick={onClose} className={`${action} w-full`}>{t.common.close}</button></footer>
      </div>
    </div>
  );
}
