import { useCallback, useEffect, useRef, useState } from 'react';
import type { CollabRole } from '../../../core/collabRoles';
import { initialsOf } from '../../../core/editingSequence';
import { CollabError, type CollabClient, type CollabInvite, type CollabProjectView } from '../../../providers/collabClient';
import { STRINGS } from '../strings';
import { readSharedLink, writeSharedLink } from './sharedLinks';

interface ShareDialogProps {
  open: boolean;
  client: CollabClient;
  /** This device's project; the shared project it is linked to is remembered per device. */
  localProjectId: string | null;
  projectName: string;
  selectedPhotoIds: string[];
  /** The signed-in person's name, or null when signed out. */
  displayName: () => Promise<string | null>;
  onClose: () => void;
}

const INVITE_ROLES: Exclude<CollabRole, 'owner'>[] = ['editor', 'commenter', 'viewer', 'client'];

/**
 * Share a project with named people (#1387 C01). Opt-in: nothing is contacted until this dialog opens, and a project
 * that is never shared keeps working offline. For now only the project name and the people are shared; the dialog says so.
 */
export default function ShareDialog({ open, client, localProjectId, projectName, selectedPhotoIds, displayName, onClose }: ShareDialogProps) {
  const t = STRINGS.share;
  const closeButton = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<CollabProjectView | null>(null);
  const [invites, setInvites] = useState<CollabInvite[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<CollabRole, 'owner'>>('editor');

  const explain = useCallback((error: unknown) => {
    const kind = error instanceof CollabError ? error.kind : 'network';
    setProblem(kind === 'not-configured' ? t.notConfigured : kind === 'sign-in' ? t.signIn : kind === 'not-entitled' ? t.notEntitled
      : kind === 'switched-off' ? t.switchedOff : kind === 'refused' && error instanceof CollabError && error.message ? error.message : t.failed);
  }, [t]);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true); setProblem(null); setNote(null);
    try { await work(); } catch (error) { explain(error); } finally { setBusy(false); }
  }, [explain]);

  useEffect(() => {
    if (!open) return;
    setView(null); setInvites([]); setProblem(null); setNote(null);
    if (!client.configured) { setProblem(t.notConfigured); return; }
    const linked = localProjectId ? readSharedLink(localProjectId) : null;
    void run(async () => {
      const [mine, waiting] = await Promise.all([linked ? client.project(linked) : Promise.resolve(null), client.invites()]);
      setView(mine); setInvites(waiting);
    });
  }, [open, client, localProjectId, run, t]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => { document.removeEventListener('keydown', handleKey, true); previous?.focus(); };
  }, [open, onClose]);

  if (!open) return null;

  const start = () => run(async () => {
    const name = await displayName();
    if (!name) throw new CollabError('sign-in');
    const id = await client.create(projectName.trim() || 'InFlight project', name);
    if (localProjectId) writeSharedLink(localProjectId, id);
    setView(await client.project(id));
  });
  const invite = () => view && run(async () => {
    const photoIds = role === 'client' ? selectedPhotoIds : undefined;
    setView(await client.invite(view.projectId, email.trim(), role, photoIds));
    setEmail(''); setNote(t.inviteSent);
  });
  const join = (item: CollabInvite) => run(async () => {
    const name = await displayName();
    if (!name) throw new CollabError('sign-in');
    await client.accept(item.projectId, name);
    setInvites((current) => current.filter((entry) => entry.projectId !== item.projectId));
    setView(await client.project(item.projectId));
  });
  const manages = view?.me.role === 'owner';
  const canInvite = view && (view.me.role === 'owner' || view.me.role === 'editor');
  const inputClass = 'min-h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-2.5 text-sm';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="v2-share-title" data-testid="share-dialog"
        className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 text-[var(--text-primary)] shadow-[var(--shadow-panel)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="v2-share-title" className="text-base font-semibold">{t.heading}</h2>
          <button ref={closeButton} type="button" onClick={onClose} className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm">{t.close}</button>
        </div>
        <p className="mb-3 text-sm text-[var(--text-secondary)]">{t.intro}</p>
        {problem && <p role="alert" className="mb-3 rounded-[var(--radius-sm)] border border-[var(--border-default)] p-2.5 text-sm">{problem}</p>}
        {note && <p role="status" className="mb-3 text-sm text-[var(--text-secondary)]">{note}</p>}

        {invites.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-1.5 text-xs font-semibold">{t.yourInvites}</h3>
            <ul className="space-y-1 text-sm">
              {invites.map((item) => (
                <li key={item.projectId} className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--bg-surface-hover)] px-2.5 py-1.5">
                  <span className="min-w-0 truncate">{item.name} · {t.roles[item.role]}</span>
                  <button type="button" disabled={busy} onClick={() => join(item)} className="min-h-9 shrink-0 rounded-[var(--radius-sm)] px-2.5 text-xs font-medium hover:bg-[var(--bg-surface-active)]">{t.join}</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!view && client.configured && (
          <button type="button" disabled={busy} onClick={start}
            className="min-h-10 rounded-[var(--radius-sm)] bg-[var(--brand-accent)] px-3 text-sm font-semibold text-[var(--text-on-accent)] disabled:opacity-50">{t.start}</button>
        )}

        {view && (
          <>
            <h3 className="mb-1.5 text-xs font-semibold">{t.people}</h3>
            <ul className="mb-3 max-h-48 space-y-1 overflow-y-auto text-sm">
              {view.members.map((member) => (
                <li key={member.accountId} className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--bg-surface-hover)] px-2.5 py-1.5">
                  <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] text-[10px] font-semibold">{initialsOf(member.displayName)}</span>
                  <span className="min-w-0 flex-1 truncate">{member.displayName}{member.accountId === view.me.accountId ? ` (${t.you})` : ''}</span>
                  <span className="shrink-0 text-xs text-[var(--text-secondary)]">{t.roles[member.role]}</span>
                </li>
              ))}
              {view.invites.map((pending, index) => (
                <li key={`invite-${index}`} className="flex items-center gap-2 px-2.5 py-1 text-[var(--text-secondary)]">
                  <span className="min-w-0 flex-1 truncate">{pending.displayName || t.invited}</span>
                  <span className="shrink-0 text-xs">{t.invited} · {t.roles[pending.role]}</span>
                </li>
              ))}
            </ul>
            {canInvite && (
              <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void invite(); }}>
                <h3 className="text-xs font-semibold">{t.inviteHeading}</h3>
                <label className="block text-xs">{t.email}
                  <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} autoComplete="off" />
                </label>
                <label className="block text-xs">{t.role}
                  <select value={role} onChange={(event) => setRole(event.target.value as Exclude<CollabRole, 'owner'>)} className={inputClass}>
                    {INVITE_ROLES.filter((option) => manages || option !== 'editor').map((option) => <option key={option} value={option}>{t.roles[option]}</option>)}
                  </select>
                </label>
                {role === 'client' && <p className="text-xs text-[var(--text-secondary)]">{t.clientHint}</p>}
                <button type="submit" disabled={busy || !email.trim() || (role === 'client' && selectedPhotoIds.length === 0)}
                  className="min-h-10 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-sm font-medium disabled:opacity-50">{t.sendInvite}</button>
              </form>
            )}
          </>
        )}
      </section>
    </div>
  );
}
