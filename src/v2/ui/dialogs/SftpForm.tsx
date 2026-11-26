import { useId, useState } from 'react';
import { STRINGS } from '../strings';
import { checkSftpSettings, SftpError, testSftp, type SftpSettings } from '../../../providers/sftpConnector';

const field = 'mt-1 block h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-xs text-[var(--text-primary)]';
const button = 'h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] disabled:opacity-50';
const label = 'block text-xs text-[var(--text-primary)]';
const hint = 'mt-1 text-[0.6875rem] text-[var(--text-muted)]';

type Place = Omit<SftpSettings, 'password' | 'privateKey' | 'passphrase'>;

/**
 * A server or NAS over SFTP (desktop app). Testing asks the server who it is; the person sees its fingerprint and saving
 * trusts it, so a server that later answers with a different identity is refused. Signing in again keeps that fingerprint.
 */
export function SftpForm({ again, onSaved, onCancel }: { again?: Place | null; onSaved: (settings: SftpSettings) => void; onCancel: () => void }) {
  const t = STRINGS.storagePlaces.sftp;
  const id = useId();
  const [host, setHost] = useState(again?.host ?? '');
  const [port, setPort] = useState(String(again?.port ?? 22));
  const [user, setUser] = useState(again?.user ?? '');
  const [root, setRoot] = useState(again?.root ?? '');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [seen, setSeen] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const settings = (pinned?: string): SftpSettings => ({
    host: host.trim(), port: Number(port), user: user.trim(), root: root.trim(),
    ...(privateKey.trim() ? { privateKey, ...(passphrase ? { passphrase } : {}) } : { password }),
    ...(pinned ? { pinned } : {}),
  });
  const edited = () => { setSeen(null); setResult(null); };

  async function test() {
    const problems = checkSftpSettings(settings());
    if (problems.length) { setResult({ ok: false, text: problems[0] }); return; }
    setBusy(true); setResult(null); setSeen(null);
    try {
      // Signing in again checks against the fingerprint accepted before; a new place learns it.
      const fingerprint = await testSftp(settings(again?.pinned));
      setSeen(fingerprint);
      setResult({ ok: true, text: again?.pinned ? t.sameServer : t.connected });
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : t.failed });
    }
    setBusy(false);
  }

  return (
    <form className="space-y-3" aria-label={t.formLabel} onSubmit={(event) => { event.preventDefault(); if (seen) onSaved(settings(seen)); }}>
      <p>{t.intro}</p>
      <div className="grid grid-cols-[1fr_5rem] gap-2">
        <div>
          <label className={label} htmlFor={`${id}-host`}>{t.host}</label>
          <input id={`${id}-host`} className={field} value={host} disabled={Boolean(again)} onChange={(event) => { setHost(event.target.value); edited(); }} placeholder="files.example.com" inputMode="url" autoComplete="off" spellCheck={false} />
        </div>
        <div>
          <label className={label} htmlFor={`${id}-port`}>{t.port}</label>
          <input id={`${id}-port`} className={field} value={port} disabled={Boolean(again)} onChange={(event) => { setPort(event.target.value.replace(/\D/g, '')); edited(); }} inputMode="numeric" autoComplete="off" />
        </div>
      </div>
      <div>
        <label className={label} htmlFor={`${id}-user`}>{t.userName}</label>
        <input id={`${id}-user`} className={field} value={user} onChange={(event) => { setUser(event.target.value); edited(); }} autoComplete="off" spellCheck={false} />
      </div>
      <div>
        <label className={label} htmlFor={`${id}-password`}>{t.password}</label>
        <input id={`${id}-password`} type="password" className={field} value={password} onChange={(event) => { setPassword(event.target.value); edited(); }} autoComplete="off" />
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-[var(--text-primary)]">{t.useKey}</summary>
        <label className={`${label} mt-2`} htmlFor={`${id}-key`}>{t.privateKey}</label>
        <textarea id={`${id}-key`} rows={4} className={`${field} h-auto py-2 font-mono`} value={privateKey} onChange={(event) => { setPrivateKey(event.target.value); edited(); }} autoComplete="off" spellCheck={false} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
        <label className={`${label} mt-2`} htmlFor={`${id}-passphrase`}>{t.passphrase}</label>
        <input id={`${id}-passphrase`} type="password" className={field} value={passphrase} onChange={(event) => { setPassphrase(event.target.value); edited(); }} autoComplete="off" />
      </details>
      <div>
        <label className={label} htmlFor={`${id}-root`}>{t.folder}</label>
        <input id={`${id}-root`} className={field} value={root} disabled={Boolean(again)} onChange={(event) => { setRoot(event.target.value); edited(); }} placeholder="/volume1/photos" autoComplete="off" spellCheck={false} />
        <p className={hint}>{t.folderHint}</p>
      </div>
      <p className={hint}>{t.sessionOnly}</p>
      {result && <p role={result.ok ? 'status' : 'alert'} className="text-xs text-[var(--text-primary)]">{result.ok ? '' : `${t.problem} `}{result.text}</p>}
      {seen && !again?.pinned && (
        <div role="group" aria-label={t.identityTitle} className="space-y-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] p-2">
          <p className="text-xs font-semibold text-[var(--text-primary)]">{t.identityTitle}</p>
          <p className="break-all font-mono text-[0.6875rem] text-[var(--text-primary)]">{seen}</p>
          <p className={hint}>{t.identityHint}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy} onClick={() => void test()}>{busy ? t.testing : t.test}</button>
        <button type="submit" className={button} disabled={busy || !seen}>{again?.pinned ? t.reconnect : t.trustAndSave}</button>
        <button type="button" className={button} onClick={onCancel}>{t.cancel}</button>
      </div>
      {!seen && <p className={hint}>{t.testFirst}</p>}
    </form>
  );
}
