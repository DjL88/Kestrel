import { useState } from 'react';
import { checkWebDavSettings, type WebDavSettings } from '../core/storageConnectors';
import { webdavConnector } from '../providers/webdavConnector';

const field = 'block min-h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm text-zinc-100';
const action = 'min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-sky-300';

/** Connect a NAS or server over WebDAV. */
export function WebDavForm({ onSaved, onCancel }: { onSaved: (settings: WebDavSettings, remember: boolean) => void; onCancel: () => void }) {
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const settings = (): WebDavSettings => ({ url: url.trim(), username: username.trim(), password });

  async function test() {
    setBusy(true); setResult(null);
    const outcome = await webdavConnector(settings()).test();
    setResult(outcome.ok ? { ok: true, text: 'Connected. Kestrel can reach the NAS.' } : { ok: false, text: outcome.reason });
    setBusy(false);
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    const problems = checkWebDavSettings(settings());
    if (problems.length) { setResult({ ok: false, text: problems[0] }); return; }
    onSaved(settings(), remember);
  }

  return (
    <form onSubmit={save} aria-label="Your NAS" className="space-y-3">
      <p>Turn on WebDAV in your NAS, then enter its address, a user and a password. Kestrel only writes inside a <code>kestrel</code> folder (and an <code>export</code> folder if you choose one for exports).</p>
      <label className="block">NAS address
        <input className={`${field} mt-1`} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://nas.local:5006/photos" inputMode="url" autoComplete="off" spellCheck={false} />
      </label>
      <label className="block">User name
        <input className={`${field} mt-1`} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <label className="block">Password
        <input type="password" className={`${field} mt-1`} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" />
      </label>
      <label className="flex min-h-11 items-start gap-2">
        <input type="checkbox" className="mt-1" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
        <span>Remember the password on this device. It is then kept unencrypted, so use a user that can reach only the photo folder. Otherwise Kestrel asks again next time.</span>
      </label>
      <p className="text-xs text-zinc-400">Your NAS may use a self-signed certificate on https; if the connection fails with one, use the NAS's normal https address with a proper certificate, or its http address on your home network. In a web browser the NAS must also allow requests from this page (CORS); the desktop app does not need that.</p>
      {result && <p role={result.ok ? 'status' : 'alert'} className={result.ok ? 'text-emerald-200' : 'text-amber-200'}>{result.text}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={action} disabled={busy} onClick={() => void test()}>Test connection</button>
        <button type="submit" className={action} disabled={busy}>Save</button>
        <button type="button" className={action} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
