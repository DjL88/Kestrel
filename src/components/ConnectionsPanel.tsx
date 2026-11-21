import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, HelpCircle, Plug, RefreshCw, Trash2 } from './icons/KestrelUIIcons';
import { PROVIDERS, type Health, type ProviderKind } from '../core/connections';
import { projectsText as t } from '../i18n/areas/projects';
import { pickSyncFolder } from '../providers/folderConnector';
import { ProviderIcon } from './ProviderIcon';
import { WebDavForm } from './WebDavForm';
import { addConnection, checkAllConnections, checkConnection, removeConnection, setS3Keys, useConnections } from '../providers/connectionStore';
import { rememberTokens } from '../providers/oauthSession';
import { CloudStorageForm } from './CloudStorageForm';
import type { S3Settings } from '../core/storageConnectors';
import { CLOUD_DRIVES, isCloudDrive } from '../core/cloudDrive';
import { cloudDriveAvailable, cloudDriveUnavailableReason, signInToCloudDrive } from '../providers/oauthSession';

const action = 'min-h-11 rounded-md border border-white/15 px-3 text-sm text-zinc-100 hover:bg-white/8 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-sky-300';
const field = 'block min-h-11 w-full rounded-md border border-white/15 bg-black/30 px-3 text-sm text-zinc-100';

/** Each health has its own icon and word as well as a colour, so it never relies on telling colours apart. */
const ICON: Record<Health, { Icon: typeof Plug; colour: string }> = {
  unknown: { Icon: HelpCircle, colour: 'text-zinc-300' },
  ok: { Icon: CheckCircle2, colour: 'text-sky-200' },
  'needs-signin': { Icon: AlertTriangle, colour: 'text-red-200' },
  offline: { Icon: CloudOff, colour: 'text-amber-200' },
  missing: { Icon: AlertTriangle, colour: 'text-red-200' },
  error: { Icon: AlertTriangle, colour: 'text-red-200' },
};

/** The words for each kind of place, in the session language. Brand names that need no words stay as core gives them. */
const providerLabel = (provider: (typeof PROVIDERS)[number]) => (t.connections.providerLabel as Partial<Record<ProviderKind, string>>)[provider.kind] ?? provider.label;
const providerShort = (kind: ProviderKind) => (t.connections.providerShort as Partial<Record<ProviderKind, string>>)[kind] ?? PROVIDERS.find((p) => p.kind === kind)?.short;
const providerNote = (provider: (typeof PROVIDERS)[number]) => (provider.note ? (t.connections.providerNote as Partial<Record<ProviderKind, string>>)[provider.kind] ?? provider.note : undefined);
const advice = (health: Health) => (t.connections.advice as Partial<Record<Health, string>>)[health] ?? '';

/** Where this person keeps their work, with a health for each, on the home page. */
export function ConnectionsPanel() {
  const { list, reports } = useConnections();
  const [adding, setAdding] = useState<ProviderKind | null>(null);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Look at every connection when the page opens, so a lost link shows up before it is needed.
  useEffect(() => { if (list.length) void checkAllConnections(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function addFolder() {
    setNote(null);
    try {
      const picked = await pickSyncFolder();
      if (picked === 'cancelled') return;
      if (picked === 'unsupported') { setNote(t.common.noFolderPicker); return; }
      const created = addConnection('folder', label || picked.name, picked.name, { handle: picked.handle, path: picked.path });
      setAdding(null); setLabel('');
      await checkConnection(created.id);
    } catch { setNote(t.common.couldNotOpenFolder); }
  }

  async function reconnect(id: string, kind: ProviderKind) {
    setNote(null);
    if (kind === 'folder') {
      const picked = await pickSyncFolder().catch(() => 'cancelled' as const);
      if (picked === 'cancelled' || picked === 'unsupported') return;
      const old = list.find((c) => c.id === id);
      if (!old) return;
      removeConnection(id);
      const created = addConnection('folder', old.label, picked.name, { handle: picked.handle, path: picked.path });
      await checkConnection(created.id);
    } else if (isCloudDrive(kind)) {
      setBusy(id);
      try { rememberTokens(id, await signInToCloudDrive(kind)); await checkConnection(id); }
      catch (error) { setNote(error instanceof Error ? error.message : t.common.couldNotOpenFolder); }
      setBusy(null);
    } else await checkConnection(id);
  }

  /** Sign in once with the person's own account; Kestrel then only sees its own folder there. */
  async function addCloudDrive(kind: 'dropbox' | 'googledrive' | 'onedrive') {
    setNote(null); setBusy(kind);
    try {
      const tokens = await signInToCloudDrive(kind);
      const created = addConnection(kind, label || CLOUD_DRIVES[kind].name, `${CLOUD_DRIVES[kind].name} · Kestrel folder`, { tokens });
      setAdding(null); setLabel('');
      await checkConnection(created.id);
    } catch (error) { setNote(error instanceof Error ? error.message : t.common.couldNotOpenFolder); }
    setBusy(null);
  }

  return (
    <section aria-labelledby="connections-title" className="mt-8 rounded-xl border border-white/10 bg-kestrel-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="connections-title" className="text-sm font-medium text-zinc-100">{t.connections.title}</h2>
        <div className="flex gap-2">
          {list.length > 0 && <button type="button" className={action} onClick={() => void checkAllConnections()}><RefreshCw className="mr-1.5 inline h-4 w-4" aria-hidden="true" />{t.connections.checkAll}</button>}
          <button type="button" className={action} onClick={() => { setAdding(adding ? null : 'folder'); setNote(null); }} aria-expanded={adding !== null}>{t.connections.add}</button>
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-400">{t.connections.intro}</p>

      {list.length === 0 && !adding && <p className="mt-3 text-sm text-zinc-300">{t.connections.nothing}</p>}

      <ul className="mt-3 space-y-2" aria-label={t.connections.listLabel}>
        {list.map((connection) => {
          const report = reports[connection.id];
          const health = report?.health ?? 'unknown';
          const { Icon, colour } = ICON[health];
          return (
            <li key={connection.id} className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/8 text-zinc-100"><ProviderIcon kind={connection.kind} className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-zinc-100">{connection.label}</p>
                    <p className="truncate text-xs text-zinc-400">{providerShort(connection.kind)} · {connection.detail}</p>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 ${colour}`} role="status" aria-label={`${connection.label}: ${t.connections.health[health]}`}>
                  <Icon className="h-4 w-4" aria-hidden="true" />{t.connections.health[health]}
                </span>
              </div>
              {health !== 'ok' && health !== 'unknown' && <p className="mt-1 text-xs text-zinc-300">{report?.message || advice(health)}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={action} disabled={busy === connection.id} onClick={async () => { setBusy(connection.id); await checkConnection(connection.id); setBusy(null); }}>{t.connections.check}</button>
                {(health === 'needs-signin' || health === 'missing') && <button type="button" className={action} onClick={() => void reconnect(connection.id, connection.kind)}>{t.connections.reconnect}</button>}
                <button type="button" className={action} onClick={() => removeConnection(connection.id)} aria-label={t.connections.remove(connection.label)}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            </li>
          );
        })}
      </ul>

      {adding && (
        <div className="mt-3 space-y-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-300" role="group" aria-label={t.connections.add}>
          <div role="radiogroup" aria-label={t.connections.kind} className="space-y-1">
            {PROVIDERS.map((provider) => {
              const cloud = isCloudDrive(provider.kind);
              const available = cloud ? cloudDriveAvailable(provider.kind as 'dropbox') : provider.available;
              const reason = cloud && !available ? cloudDriveUnavailableReason(provider.kind as 'dropbox') : null;
              return (
                <label key={provider.kind} className={`flex min-h-11 items-start gap-2 ${available ? '' : 'opacity-60'}`}>
                  <input type="radio" name="provider" className="mt-1" disabled={!available} checked={adding === provider.kind} onChange={() => setAdding(provider.kind)} />
                  <span className="flex items-start gap-2"><ProviderIcon kind={provider.kind} className="mt-0.5 h-5 w-5 shrink-0" /><span>{providerLabel(provider)}{(reason ?? (provider.note && !cloud ? providerNote(provider) : null)) && <span className="block text-xs text-zinc-400">{reason ?? providerNote(provider)}</span>}</span></span>
                </label>
              );
            })}
          </div>
          <label className="block">{t.connections.nameIt}
            <input className={`${field} mt-1`} value={label} onChange={(event) => setLabel(event.target.value)} />
          </label>
          {adding === 'webdav' && (
            <WebDavForm onCancel={() => setAdding(null)} onSaved={(settings, remember) => {
              const created = addConnection('webdav', label || new URL(settings.url).host, `${new URL(settings.url).host}${new URL(settings.url).pathname.replace(/\/$/, '')}`, { dav: settings, remember });
              setAdding(null); setLabel('');
              void checkConnection(created.id);
            }} />
          )}
          {isCloudDrive(adding) && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-400">Kestrel opens {CLOUD_DRIVES[adding].name}'s own sign-in page. It never sees your password, and can only see its own Kestrel folder, not the rest of your account.</p>
              <button type="button" className={action} disabled={busy === adding} onClick={() => void addCloudDrive(adding)}>Sign in with {CLOUD_DRIVES[adding].name}</button>
            </div>
          )}
          {adding === 'folder' && <button type="button" className={action} onClick={() => void addFolder()}>{t.connections.chooseFolder}</button>}
          {adding === 's3' && (
            <CloudStorageForm initial={null} persist={false} onCancel={() => setAdding(null)} onSaved={(settings: S3Settings | null, remember?: boolean) => {
              if (!settings) return;
              const created = addConnection('s3', label || settings.bucket, `${settings.bucket} · ${new URL(settings.endpoint).host}`);
              setS3Keys(created.id, settings, Boolean(remember));
              setAdding(null); setLabel('');
              void checkConnection(created.id);
            }} />
          )}
        </div>
      )}
      {note && <p role="status" className="mt-2 text-sm text-amber-200">{note}</p>}
    </section>
  );
}
