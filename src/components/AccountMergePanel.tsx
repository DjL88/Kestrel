import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SignInMethod } from '../core/accountLinking';
import { accountMergeClient, MergeError, type MergePreview, type MergeSummary } from '../providers/accountMergeClient';
import { firebaseAuth, isMicrosoftSignInEnabled, signInOtherAccount, signInPlatform } from '../providers/firebaseAuth';
import { projectsText } from '../i18n/areas/projects';
import { methodName } from './SignInMethodsPanel';

/**
 * Settings → Account: bring a second InFlight account into this one (accountMerge on the control plane). The person
 * signs in to the other account here (kept in memory only), sees exactly what moves, confirms, and can undo for 30
 * days. Nothing on the device changes either way.
 */
export function AccountMergePanel({ disabled, className, onNote }: { disabled: boolean; className: string; onNote: (text: string) => void }) {
  const t = projectsText.accountMerge;
  const client = useMemo(() => accountMergeClient(import.meta.env.VITE_KESTREL_CONTROL_PLANE_URL, () => firebaseAuth.idToken()), []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [merges, setMerges] = useState<MergeSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const day = (ms: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(ms);
  const money = (millicredits: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP' }).format(millicredits / 100_000);

  const explain = useCallback((error: unknown) => {
    const code = error instanceof MergeError ? error.code : '';
    onNote(code === 'MERGE_SAME_ACCOUNT' ? t.blockedSame : code === 'MERGE_SAFE_COPY' ? t.blockedSafeCopy : code === 'MERGE_NOT_ACTIVE' ? t.blockedInactive
      : code === 'MERGE_TICKET_EXPIRED' || code === 'MERGE_TICKET_INVALID' ? t.expired : code === 'MERGE_UNDO_BALANCE_SPENT' ? t.undoSpent
      : code === 'MERGE_UNDO_EXPIRED' ? t.undoExpired : error instanceof Error && !(error instanceof MergeError) ? error.message : t.failed);
  }, [onNote, t]);

  const reload = useCallback(() => { void client.list().then(setMerges, () => setMerges([])); }, [client]);
  useEffect(() => { if (client.configured) reload(); }, [client, reload]);
  if (!client.configured) return null;

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await work(); } catch (error) { explain(error); } finally { setBusy(false); }
  }
  const signInOther = (method: SignInMethod) => run(async () => {
    const otherToken = await signInOtherAccount(method, email, password);
    setPassword('');
    const next = await client.ticket(otherToken);
    const p = await client.preview(next);
    setTicket(next); setPreview(p);
    if (p.blocked) explain(new MergeError(p.blocked === 'same-account' ? 'MERGE_SAME_ACCOUNT' : p.blocked === 'safe-copy' ? 'MERGE_SAFE_COPY' : 'MERGE_NOT_ACTIVE', ''));
  });
  const confirm = () => ticket && run(async () => {
    const done = await client.merge(ticket);
    setTicket(null); setPreview(null);
    onNote(t.done(day(done.undoUntilMs)));
    reload();
  });
  const undo = (mergeId: string) => run(async () => { await client.undo(mergeId); onNote(t.undone); reload(); });

  const live = merges.filter((m) => m.status === 'done' && m.undoUntilMs > Date.now());
  return (
    <section aria-labelledby="account-merge-h" className="space-y-2 rounded-lg border border-[var(--account-border,#ffffff1a)] p-3" data-testid="account-merge">
      <h4 id="account-merge-h" className="font-medium text-[var(--account-foreground,#f4f4f5)]">{t.heading}</h4>
      <p className="text-sm">{t.intro}</p>
      {live.map((m) => (
        <div key={m.mergeId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{t.merged(day(m.undoUntilMs))}</span>
          <button type="button" className={className} disabled={disabled || busy} onClick={() => void undo(m.mergeId)}>{t.undo}</button>
        </div>
      ))}
      {!preview && (
        <>
          <p className="text-sm">{t.step1}</p>
          {signInPlatform() === 'web' && (
            <div className="flex flex-wrap gap-2">
              {(isMicrosoftSignInEnabled() ? ['google', 'apple', 'microsoft'] as const : ['google', 'apple'] as const).map((m: SignInMethod) => (
                <button key={m} type="button" className={className} disabled={disabled || busy} onClick={() => void signInOther(m)}>{t.signInOtherWith(methodName(m))}</button>
              ))}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-sm">{t.otherEmail}
              <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block min-h-11 w-full rounded-md border border-[var(--account-border,#ffffff26)] bg-[var(--account-field,#0000004d)] px-3 text-sm" />
            </label>
            <label className="block text-sm">{t.otherPassword}
              <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block min-h-11 w-full rounded-md border border-[var(--account-border,#ffffff26)] bg-[var(--account-field,#0000004d)] px-3 text-sm" />
            </label>
          </div>
          <button type="button" className={className} disabled={disabled || busy || !email.trim() || !password} onClick={() => void signInOther('password')}>{t.signInOther}</button>
        </>
      )}
      {preview && !preview.blocked && (
        <div className="space-y-1 text-sm" data-testid="account-merge-preview">
          <p className="font-medium">{t.previewHeading}</p>
          <ul className="list-disc pl-5">
            <li>{t.licences(preview.licences)}</li>
            <li>{t.balance(money(preview.balanceMillicredits))}</li>
            <li>{t.projects(preview.projects)}</li>
            <li>{t.devices(preview.pushDevices)}</li>
          </ul>
          <p>{t.afterNote}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={className} disabled={disabled || busy} onClick={() => void confirm()}>{t.confirm}</button>
            <button type="button" className={className} disabled={busy} onClick={() => { setTicket(null); setPreview(null); }}>{t.cancel}</button>
          </div>
        </div>
      )}
      {preview?.blocked && <button type="button" className={className} disabled={busy} onClick={() => { setTicket(null); setPreview(null); }}>{t.cancel}</button>}
    </section>
  );
}
