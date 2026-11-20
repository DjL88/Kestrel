import { useState } from 'react';
import { checkS3Settings, type S3Settings } from '../core/storageConnectors';
import { forgetCloudSettings, isCloudRemembered, saveCloudSettings } from '../providers/cloudSettings';
import { s3Connector } from '../providers/s3Connector';
import { projectsText as t } from '../i18n/areas/projects';

const field = 'block min-h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm text-zinc-100';
const action = 'min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-sky-300';

/** Where to keep your synced files: any storage that speaks the S3 interface (Amazon S3, Backblaze B2, Cloudflare R2, Wasabi, MinIO, many NAS boxes). */
export function CloudStorageForm({ initial, onSaved, onCancel, persist = true }: { initial: S3Settings | null; onSaved: (settings: S3Settings | null, remember?: boolean) => void; onCancel: () => void; /** Keep these details in the single "my cloud storage" slot. Off when the caller keeps them itself. */ persist?: boolean }) {
  const [endpoint, setEndpoint] = useState(initial?.endpoint ?? '');
  const [region, setRegion] = useState(initial?.region ?? '');
  const [bucket, setBucket] = useState(initial?.bucket ?? '');
  const [accessKeyId, setAccessKeyId] = useState(initial?.accessKeyId ?? '');
  const [secretAccessKey, setSecretAccessKey] = useState(initial?.secretAccessKey ?? '');
  const [remember, setRemember] = useState(isCloudRemembered());
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const settings = (): S3Settings => ({ endpoint: endpoint.trim(), region: region.trim(), bucket: bucket.trim(), accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim() });

  async function test() {
    setBusy(true); setResult(null);
    const outcome = await s3Connector(settings()).test();
    setResult(outcome.ok ? { ok: true, text: t.cloud.connected } : { ok: false, text: outcome.reason });
    setBusy(false);
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    const problems = checkS3Settings(settings());
    if (problems.length) { setResult({ ok: false, text: problems[0] }); return; }
    if (persist) saveCloudSettings(settings(), remember);
    onSaved(settings(), remember);
  }

  return (
    <form onSubmit={save} aria-label={t.cloud.formLabel} className="space-y-3">
      <p>{t.cloud.introStart}<code>kestrel</code>{t.cloud.introEnd}</p>
      <label className="block">{t.cloud.address}
        <input className={`${field} mt-1`} value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://s3.eu-west-2.amazonaws.com" inputMode="url" autoComplete="off" spellCheck={false} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">{t.cloud.region}
          <input className={`${field} mt-1`} value={region} onChange={(event) => setRegion(event.target.value)} placeholder="eu-west-2" autoComplete="off" spellCheck={false} />
        </label>
        <label className="block">{t.cloud.bucket}
          <input className={`${field} mt-1`} value={bucket} onChange={(event) => setBucket(event.target.value)} placeholder="my-photos" autoComplete="off" spellCheck={false} />
        </label>
      </div>
      <label className="block">{t.cloud.accessKey}
        <input className={`${field} mt-1 font-mono`} value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <label className="block">{t.cloud.secretKey}
        <input type="password" className={`${field} mt-1 font-mono`} value={secretAccessKey} onChange={(event) => setSecretAccessKey(event.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <label className="flex min-h-11 items-start gap-2">
        <input type="checkbox" className="mt-1" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
        <span>{t.cloud.remember}</span>
      </label>
      <p className="text-xs text-zinc-400">{t.cloud.keysNote}</p>
      {result && <p role={result.ok ? 'status' : 'alert'} className={result.ok ? 'text-emerald-200' : 'text-amber-200'}>{result.text}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={action} disabled={busy} onClick={() => void test()}>{t.common.testConnection}</button>
        <button type="submit" className={action} disabled={busy}>{t.common.save}</button>
        <button type="button" className={action} onClick={onCancel}>{t.common.cancel}</button>
        {initial && persist && <button type="button" className={action} onClick={() => { forgetCloudSettings(); onSaved(null); }}>{t.cloud.forget}</button>}
      </div>
    </form>
  );
}
