import { useCallback, useEffect, useId, useState } from 'react';
import { AccountDataError, type AccountDataClient, type DeletionPreview, type DeletionState } from '../providers/accountDataClient';
import { accountDataFileName } from '../core/accountDataArchive';
import { projectsText } from '../i18n/areas/projects';

/** The word the person types. The server checks the same word (accountErasure.ts DELETION_CONFIRM_WORD). */
export const DELETE_WORD = 'DELETE';

/**
 * Settings → Account: "Download my data" and "Delete my account" (UK GDPR access, portability and erasure). Deleting
 * waits 30 days and can be undone until then. Only the online account is involved: nothing on the device is read or
 * changed. Shown only when the `accountData` feature flag is on (off by default).
 */
export function AccountDataPanel({ client, disabled, className, onNote, save }: {
  client: AccountDataClient; disabled: boolean; className: string; onNote: (text: string) => void;
  save: (blob: Blob, name: string) => void;
}) {
  const t = projectsText.accountData;
  const inputId = useId();
  const [state, setState] = useState<{ deletion: DeletionState | null; preview: DeletionPreview } | null>(null);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const day = (ms: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(ms);
  const money = (millicredits: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'GBP' }).format(millicredits / 100_000);

  const reload = useCallback(() => { void client.deletion().then(setState, () => setState(null)); }, [client]);
  useEffect(() => { if (client.configured) reload(); }, [client, reload]);
  if (!client.configured) return null;

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await work(); } catch (error) {
      const code = error instanceof AccountDataError ? error.code : '';
      onNote(code === 'DELETION_SAFE_COPY' ? t.blockedSafeCopy : error instanceof AccountDataError && code !== 'REFUSED' ? error.message : t.failed);
    } finally { setBusy(false); }
  }
  const download = () => run(async () => {
    onNote(t.downloading);
    save(await client.download(t.readme), accountDataFileName(Date.now()));
    onNote(t.downloaded);
  });
  const confirm = () => run(async () => {
    const deletion = await client.scheduleDeletion(typed);
    setAsking(false); setTyped('');
    onNote(t.scheduled(day(deletion.deleteAfterMs)));
    reload();
  });
  const keep = () => run(async () => { await client.cancelDeletion(); onNote(t.kept); reload(); });

  const preview = state?.preview;
  const deletion = state?.deletion ?? null;
  const matches = typed.trim().toUpperCase() === DELETE_WORD;
  return (
    <section aria-labelledby="account-data-h" className="space-y-2 rounded-lg border border-[var(--account-border,#ffffff1a)] p-3" data-testid="account-data">
      <h4 id="account-data-h" className="font-medium text-[var(--account-foreground,#f4f4f5)]">{t.heading}</h4>
      <p className="text-sm">{t.intro}</p>
      <button type="button" className={className} disabled={disabled || busy} onClick={() => void download()}>{t.download}</button>
      {deletion && (
        <div className="space-y-2 text-sm" data-testid="account-deletion-scheduled">
          <p role="status"><strong>{t.scheduled(day(deletion.deleteAfterMs))}</strong></p>
          {deletion.status === 'scheduled' && <button type="button" className={className} disabled={disabled || busy} onClick={() => void keep()}>{t.keep}</button>}
        </div>
      )}
      {!deletion && !asking && (
        <div><button type="button" className={className} disabled={disabled || busy || !preview} onClick={() => setAsking(true)}>{t.deleteStart}</button></div>
      )}
      {!deletion && asking && preview && (
        <div className="space-y-2 text-sm" data-testid="account-deletion-confirm">
          {preview.blocked === 'safe-copy' ? <p role="alert">{t.blockedSafeCopy}</p> : (
            <>
              <p className="font-medium">{t.whatHappens}</p>
              <ul className="list-disc space-y-1 pl-5">
                {preview.licences > 0 && <li>{t.licences(preview.licences)}</li>}
                {preview.ownedSharedProjects > 0 && <li>{t.owned(preview.ownedSharedProjects, preview.peopleInOwnedProjects)}</li>}
                {preview.otherSharedProjects > 0 && <li>{t.others(preview.otherSharedProjects)}</li>}
                {preview.balanceMillicredits > 0 && <li>{t.balance(money(preview.balanceMillicredits))}</li>}
                <li>{t.localStays}</li>
                <li>{t.grace}</li>
              </ul>
              <label htmlFor={inputId} className="block">{t.typeToConfirm(DELETE_WORD)}</label>
              <input id={inputId} type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)}
                className="block min-h-11 w-full max-w-xs rounded-md border border-[var(--account-border,#ffffff26)] bg-[var(--account-field,#0000004d)] px-3 text-sm" />
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {preview.blocked === null && <button type="button" className={className} disabled={disabled || busy || !matches} onClick={() => void confirm()}>{t.confirm}</button>}
            <button type="button" className={className} disabled={busy} onClick={() => { setAsking(false); setTyped(''); }}>{t.cancel}</button>
          </div>
        </div>
      )}
    </section>
  );
}
