import { useEffect, useState } from 'react';
import { PROVIDERS, type Health, type ProviderKind } from '../../../core/connections';
import { CLOUD_DRIVES, isCloudDrive } from '../../../core/cloudDrive';
import type { S3Settings } from '../../../core/storageConnectors';
import type { BrandIconId } from '../../../core/brandIcons';
import { addConnection, checkAllConnections, checkConnection, removeConnection, setS3Keys, useConnections } from '../../../providers/connectionStore';
import { cloudDriveAvailable, cloudDriveUnavailableReason, rememberTokens, signInToCloudDrive } from '../../../providers/oauthSession';
import { pickSyncFolder } from '../../../providers/folderConnector';
import { BrandIcon, WorksWith } from '../../../components/BrandIcon';
import { ProviderIcon } from '../../../components/ProviderIcon';
import { WebDavForm } from '../../../components/WebDavForm';
import { CloudStorageForm } from '../../../components/CloudStorageForm';

/**
 * Where the person keeps their work, in V2 Settings. It is the same connections as the current app (one shared store, so
 * a place added in either shows in both): folders and shared drives, a NAS over WebDAV, S3-compatible storage, and
 * Dropbox, Google Drive and OneDrive. Each shows a plain word for its health as well as an icon.
 */
const HEALTH_WORD: Record<Health, string> = {
  unknown: 'Not checked', ok: 'Connected', 'needs-signin': 'Sign in again', offline: 'Offline', missing: 'Not found', error: 'Problem',
};
const WORKS_WITH: Partial<Record<ProviderKind, readonly { id?: BrandIconId; name: string }[]>> = {
  webdav: [{ id: 'synology', name: 'Synology' }, { id: 'qnap', name: 'QNAP' }, { id: 'nextcloud', name: 'Nextcloud' }, { id: 'owncloud', name: 'ownCloud' }],
  s3: [{ name: 'Amazon S3' }, { id: 'backblaze', name: 'Backblaze B2' }, { id: 'cloudflare', name: 'Cloudflare R2' }, { id: 'wasabi', name: 'Wasabi' }, { id: 'minio', name: 'MinIO' }],
};
const button = 'h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-primary)] disabled:opacity-50';

export function StorageConnections() {
  const { list, reports } = useConnections();
  const [adding, setAdding] = useState<ProviderKind | null>(null);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { if (list.length) void checkAllConnections(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const done = () => { setAdding(null); setLabel(''); };

  async function addFolder() {
    setNote(null);
    try {
      const picked = await pickSyncFolder();
      if (picked === 'cancelled') return;
      if (picked === 'unsupported') { setNote('This browser cannot pick a folder. Use the desktop app, or a NAS or cloud option.'); return; }
      const created = addConnection('folder', label || picked.name, picked.name, { handle: picked.handle, path: picked.path });
      done();
      await checkConnection(created.id);
    } catch { setNote('That folder could not be opened.'); }
  }

  async function signIn(kind: 'dropbox' | 'googledrive' | 'onedrive', reconnectId?: string) {
    setNote(null); setBusy(reconnectId ?? kind);
    try {
      const tokens = await signInToCloudDrive(kind);
      if (reconnectId) { rememberTokens(reconnectId, tokens); await checkConnection(reconnectId); }
      else {
        const created = addConnection(kind, label || CLOUD_DRIVES[kind].name, `${CLOUD_DRIVES[kind].name} · InFlight folder`, { tokens });
        done();
        await checkConnection(created.id);
      }
    } catch (error) { setNote(error instanceof Error ? error.message : 'That sign-in did not finish.'); }
    setBusy(null);
  }

  return (
    <section className="space-y-2" aria-labelledby="v2-connections-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="v2-connections-title" className="text-xs font-semibold text-[var(--text-primary)]">Where your work lives</h3>
        <div className="flex gap-2">
          {list.length > 0 && <button type="button" className={button} onClick={() => void checkAllConnections()}>Check all</button>}
          <button type="button" className={button} aria-expanded={adding !== null} onClick={() => { setAdding(adding ? null : 'folder'); setNote(null); }}>Add a place</button>
        </div>
      </div>
      <p className="text-[11px] text-[var(--text-muted)]">Folders, a NAS, your own cloud storage, Dropbox, Google Drive or OneDrive. Your originals are never changed; InFlight stores links, previews and recipes.</p>

      {list.length === 0 && !adding && <p className="text-xs text-[var(--text-secondary)]">Nothing connected yet.</p>}

      <ul className="space-y-2" aria-label="Connected places">
        {list.map((connection) => {
          const health = reports[connection.id]?.health ?? 'unknown';
          return (
            <li key={connection.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3.5 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <ProviderIcon kind={connection.kind} className="h-5 w-5 shrink-0 text-[var(--text-primary)]" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-[var(--text-primary)]">{connection.label}</p>
                  <p className="truncate text-[11px] text-[var(--text-muted)]">{connection.detail}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span role="status" className="text-[11px] text-[var(--text-secondary)]">{HEALTH_WORD[health]}{reports[connection.id]?.message && health !== 'ok' ? `: ${reports[connection.id]!.message}` : ''}</span>
                <button type="button" className={button} disabled={busy === connection.id} onClick={async () => { setBusy(connection.id); await checkConnection(connection.id); setBusy(null); }}>Check</button>
                {(health === 'needs-signin') && isCloudDrive(connection.kind) && <button type="button" className={button} onClick={() => void signIn(connection.kind as 'dropbox', connection.id)}>Sign in again</button>}
                <button type="button" className={button} onClick={() => removeConnection(connection.id)} aria-label={`Remove ${connection.label}`}>Remove</button>
              </div>
            </li>
          );
        })}
      </ul>

      {adding && (
        <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3 text-xs text-[var(--text-secondary)]" role="group" aria-label="Add a place">
          <div role="radiogroup" aria-label="Kind of place" className="space-y-1">
            {PROVIDERS.map((provider) => {
              const cloud = isCloudDrive(provider.kind);
              const available = cloud ? cloudDriveAvailable(provider.kind as 'dropbox') : provider.available;
              const reason = cloud && !available ? cloudDriveUnavailableReason(provider.kind as 'dropbox') : null;
              return (
                <label key={provider.kind} className={`flex min-h-9 items-start gap-2 ${available ? '' : 'opacity-60'}`}>
                  <input type="radio" name="v2-provider" className="mt-1" disabled={!available} checked={adding === provider.kind} onChange={() => setAdding(provider.kind)} />
                  <span className="flex items-start gap-2">
                    <ProviderIcon kind={provider.kind} className="mt-0.5 h-5 w-5 shrink-0 text-[var(--text-primary)]" />
                    <span className="text-[var(--text-primary)]">{provider.label}
                      {reason && <span className="block text-[11px] text-[var(--text-muted)]">{reason}</span>}
                      {WORKS_WITH[provider.kind] && <WorksWith items={WORKS_WITH[provider.kind]!} />}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <label className="block text-[var(--text-primary)]">Name it
            <input className="mt-1 block h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-xs" value={label} onChange={(event) => setLabel(event.target.value)} />
          </label>
          {adding === 'folder' && <button type="button" className={button} onClick={() => void addFolder()}>Choose a folder</button>}
          {adding === 'webdav' && (
            <WebDavForm onCancel={() => setAdding(null)} onSaved={(settings, remember) => {
              const url = new URL(settings.url);
              const created = addConnection('webdav', label || url.host, `${url.host}${url.pathname.replace(/\/$/, '')}`, { dav: settings, remember });
              done(); void checkConnection(created.id);
            }} />
          )}
          {adding === 's3' && (
            <CloudStorageForm initial={null} persist={false} onCancel={() => setAdding(null)} onSaved={(settings: S3Settings | null, remember?: boolean) => {
              if (!settings) return;
              const created = addConnection('s3', label || settings.bucket, `${settings.bucket} · ${new URL(settings.endpoint).host}`);
              setS3Keys(created.id, settings, Boolean(remember));
              done(); void checkConnection(created.id);
            }} />
          )}
          {isCloudDrive(adding) && (
            <div className="space-y-2">
              <p className="text-[11px] text-[var(--text-muted)]">InFlight opens {CLOUD_DRIVES[adding].name}'s own sign-in page. It never sees your password and can only see its own InFlight folder.</p>
              <button type="button" className={`${button} inline-flex items-center gap-2`} disabled={busy === adding} onClick={() => void signIn(adding as 'dropbox')}>
                {(adding === 'dropbox' || adding === 'googledrive') && <BrandIcon id={adding} className="h-4 w-4" />}
                Sign in with {CLOUD_DRIVES[adding].name}
              </button>
            </div>
          )}
        </div>
      )}
      {note && <p role="status" className="text-xs text-[var(--text-secondary)]">{note}</p>}
    </section>
  );
}
