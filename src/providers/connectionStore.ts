import { useSyncExternalStore } from 'react';
import { healthFromFailure, newConnectionId, type Connection, type Health, type HealthReport, type ProviderKind } from '../core/connections';
import type { S3Settings, StorageConnector, WebDavSettings } from '../core/storageConnectors';
import { directoryHandleConnector } from './folderConnector';
import { isDesktopApp } from './desktopShell';
import { s3Connector } from './s3Connector';
import { webdavConnector } from './webdavConnector';

/**
 * The person's saved connections and how healthy each one is. Details that are not secret (name, where it points) are
 * kept in the app's storage; keys are kept only as the person chose (this session, or remembered on this device).
 */
const KEY = 'kestrel.connections.v1';
const SECRET_PREFIX = 'kestrel.connection-keys.v1.';
const sessionKeys = new Map<string, S3Settings>();
const sessionDav = new Map<string, WebDavSettings>();
const DAV_PREFIX = 'kestrel.connection-dav.v1.';
// Remote credentials are session-only until a native OS keychain integration exists.
// `remember` is accepted for backwards-compatible callers but NEVER persists secrets.
// Existing plaintext credentials from older versions are purged at startup.
function purgeLegacyCredentials(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(SECRET_PREFIX) || key?.startsWith(DAV_PREFIX)) localStorage.removeItem(key);
    }
  } catch { /* Storage may be unavailable: never attempt to recover persisted secrets. */ }
}
purgeLegacyCredentials();
const sessionHandles = new Map<string, FileSystemDirectoryHandle>();
const reports: Record<string, HealthReport | undefined> = {};
const listeners = new Set<() => void>();
let list: Connection[] = read();
let snapshot = { list, reports: { ...reports } };

function read(): Connection[] {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(stored) ? stored.filter((c): c is Connection => Boolean(c && typeof c.id === 'string' && typeof c.label === 'string' && typeof c.detail === 'string' && ['folder', 's3', 'webdav', 'dropbox', 'googledrive', 'onedrive'].includes(c.kind))) : [];
  } catch { return []; }
}
const publish = () => {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* kept for this session */ }
  snapshot = { list, reports: { ...reports } };
  listeners.forEach((listener) => listener());
};

export const connections = () => list;
export const healthOf = (id: string) => reports[id];

export function addConnection(kind: ProviderKind, label: string, detail: string, secret?: { s3?: S3Settings; dav?: WebDavSettings; remember?: boolean; handle?: FileSystemDirectoryHandle; path?: string }): Connection {
  const connection: Connection = { id: newConnectionId(), kind, label: label.trim() || detail, detail };
  list = [...list, connection];
  if (secret?.s3) setS3Keys(connection.id, secret.s3, Boolean(secret.remember));
  if (secret?.dav) setDavLogin(connection.id, secret.dav, Boolean(secret.remember));
  if (secret?.handle) sessionHandles.set(connection.id, secret.handle);
  if (secret?.path) { try { localStorage.setItem(`kestrel.connection-path.v1.${connection.id}`, secret.path); } catch { /* session only */ } }
  publish();
  return connection;
}

export function removeConnection(id: string): void {
  list = list.filter((c) => c.id !== id);
  sessionKeys.delete(id); sessionDav.delete(id); sessionHandles.delete(id); delete reports[id];
  try { localStorage.removeItem(SECRET_PREFIX + id); localStorage.removeItem(DAV_PREFIX + id); localStorage.removeItem(`kestrel.connection-path.v1.${id}`); } catch { /* nothing to remove */ }
  publish();
}

export function setS3Keys(id: string, settings: S3Settings, _remember: boolean): void {
  sessionKeys.set(id, settings);
  try { localStorage.removeItem(SECRET_PREFIX + id); } catch { /* session only */ }
}

export function setDavLogin(id: string, settings: WebDavSettings, _remember: boolean): void {
  sessionDav.set(id, settings);
  try { localStorage.removeItem(DAV_PREFIX + id); } catch { /* session only */ }
}

function davLoginFor(id: string): WebDavSettings | null {
  const held = sessionDav.get(id);
  if (held) return held;
  return null;
}

function s3KeysFor(id: string): S3Settings | null {
  const held = sessionKeys.get(id);
  if (held) return held;
  return null;
}

export type Opened = { connector: StorageConnector } | { problem: Health; message: string };

/** The way to read and write one connection, or the plain reason it cannot be used right now. */
export async function openConnection(id: string): Promise<Opened> {
  const connection = list.find((c) => c.id === id);
  if (!connection) return { problem: 'missing', message: 'That connection was removed.' };
  if (connection.kind === 's3') {
    const keys = s3KeysFor(id);
    if (!keys) return { problem: 'needs-signin', message: 'The keys were not remembered. Enter them again to reconnect.' };
    return { connector: s3Connector(keys) };
  }
  if (connection.kind === 'webdav') {
    const login = davLoginFor(id);
    if (!login) return { problem: 'needs-signin', message: 'The password was not remembered. Enter it again to reconnect.' };
    return { connector: webdavConnector(login) };
  }
  if (connection.kind === 'folder') {
    if (isDesktopApp()) {
      const path = (() => { try { return localStorage.getItem(`kestrel.connection-path.v1.${id}`); } catch { return null; } })();
      if (!path) return { problem: 'missing', message: 'Choose the folder again.' };
      const { desktopFolderConnector } = await import('./folderConnector');
      return { connector: await desktopFolderConnector(path) };
    }
    const handle = sessionHandles.get(id);
    // A browser forgets folder access when the page is closed; the person must allow it again.
    if (!handle) return { problem: 'needs-signin', message: 'The browser asks again for access to this folder after it has been closed. Choose it again to reconnect.' };
    const permission = await (handle as unknown as { queryPermission?: (o: { mode: string }) => Promise<string> }).queryPermission?.({ mode: 'readwrite' });
    if (permission && permission !== 'granted') return { problem: 'needs-signin', message: 'Access to this folder was withdrawn. Choose it again to reconnect.' };
    return { connector: directoryHandleConnector(handle) };
  }
  return { problem: 'error', message: 'This kind of connection is not available yet.' };
}

/** Check one connection now and remember the result. */
export async function checkConnection(id: string, now = Date.now()): Promise<HealthReport> {
  const opened = await openConnection(id);
  let report: HealthReport;
  if ('problem' in opened) report = { health: opened.problem, message: opened.message, checkedAt: now };
  else {
    const result = await opened.connector.test();
    report = result.ok ? { health: 'ok', message: 'Connected.', checkedAt: now } : { health: result.health ?? healthFromFailure({}), message: result.reason, checkedAt: now };
  }
  reports[id] = report;
  publish();
  return report;
}

export const checkAllConnections = () => Promise.all(list.map((c) => checkConnection(c.id)));

export function useConnections() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot, () => snapshot);
}
