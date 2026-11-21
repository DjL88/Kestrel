import { useState } from 'react';
import { checkWebDavSettings, type WebDavSettings } from '../core/storageConnectors';
import { webdavConnector } from '../providers/webdavConnector';
import { projectsText as t } from '../i18n/areas/projects';

const field = 'block min-h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm text-zinc-100';
const action = 'min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-sky-300';

/** Connect a NAS or server over WebDAV. */
export function WebDavForm({ onSaved, onCancel }: { onSaved: (settings: WebDavSettings, remember: boolean) => void; onCancel: () => void }) {
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const settings = (): WebDavSettings => ({ url: url.trim(), username: username.trim(), password });

  async function test() {
    setBusy(true); setResult(null);
    const outcome = await webdavConnector(settings()).test();
    setResult(outcome.ok ? { ok: true, text: t.webdav.connected } : { ok: false, text: outcome.reason });
    setBusy(false);
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    const problems = checkWebDavSettings(settings());
    if (problems.length) { setResult({ ok: false, text: problems[0] }); return; }
    onSaved(settings(), false);
  }

  return (
    <form onSubmit={save} aria-label={t.webdav.formLabel} className="space-y-3">
      <p>{t.webdav.introStart}<code>kestrel</code>{t.webdav.introMiddle}<code>export</code>{t.webdav.introEnd}</p>
      <label className="block">{t.webdav.address}
        <input className={`${field} mt-1`} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://nas.local:5006/photos" inputMode="url" autoComplete="off" spellCheck={false} />
      </label>
      <label className="block">{t.webdav.userName}
        <input className={`${field} mt-1`} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <label className="block">{t.webdav.password}
        <input type="password" className={`${field} mt-1`} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" />
      </label>
      <p className="text-xs text-zinc-400">{t.webdav.certificateNote} Your password is kept only while Kestrel is open; enter it again after restarting.</p>
      {result && <p role={result.ok ? 'status' : 'alert'} className={result.ok ? 'text-emerald-200' : 'text-amber-200'}>{result.text}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={action} disabled={busy} onClick={() => void test()}>{t.common.testConnection}</button>
        <button type="submit" className={action} disabled={busy}>{t.common.save}</button>
        <button type="button" className={action} onClick={onCancel}>{t.common.cancel}</button>
      </div>
    </form>
  );
}
