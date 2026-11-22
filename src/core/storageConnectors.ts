/**
 * Where synced files go. The person picks one place: a folder (including one managed by iCloud Drive, Dropbox, OneDrive or
 * Google Drive's app), their own S3-compatible bucket, a WebDAV or NAS share, or InFlight's managed storage. All of them
 * look the same to the app: put, get, list, remove, under one shared layout. Nothing here talks to a network.
 */
export type ConnectorKind = 'folder' | 's3' | 'webdav' | 'managed';

/** What is synced. Each level is switched on separately; originals are never part of the first two. */
export type SyncLevel = 'recipes' | 'previews' | 'originals';

export interface StorageConnector {
  readonly kind: ConnectorKind;
  /** A cheap round trip to show "connected" or a plain reason it is not. */
  test(): Promise<{ ok: true } | { ok: false; reason: string; health?: import('./connections').Health }>;
  put(path: string, bytes: Uint8Array, sha256: string): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
  list(prefix: string): Promise<string[]>;
  remove(path: string): Promise<void>;
}

export const SYNC_ROOT = 'kestrel/v1';
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The one layout every connector uses, so a project can move between them. Ids must be plain, so a path cannot escape the root. */
export function syncPath(level: SyncLevel, projectId: string, photoId: string): string {
  if (!SAFE.test(projectId) || !SAFE.test(photoId)) throw new Error('Unsafe name in a sync path.');
  const ending = level === 'recipes' ? 'json' : level === 'previews' ? 'jpg' : 'orig';
  return `${SYNC_ROOT}/${level}/${projectId}/${photoId}.${ending}`;
}

/** Only paths inside the InFlight folder are ever read, written or removed. */
export function isInsideSyncRoot(path: string): boolean {
  return path.startsWith(`${SYNC_ROOT}/`) && !path.split('/').some((part) => part === '..' || part === '.' || part === '');
}

/**
 * Exports may also be saved to a folder called "export" in a place the person chose (for example beside their originals).
 * That is the only place outside InFlight's own folder that is ever written to, and files there are never read or removed.
 */
export function isInsideExportRoot(path: string): boolean {
  return path.startsWith('export/') && !path.split('/').some((part) => part === '..' || part === '.' || part === '');
}

/** What a connector may write: its own folder, or the export folder. */
export const isWritablePath = (path: string) => isInsideSyncRoot(path) || isInsideExportRoot(path);

/** The settings for a NAS or server reached over WebDAV (Synology, QNAP, Nextcloud, ownCloud and others). */
export interface WebDavSettings { url: string; username: string; password: string }

export function checkWebDavSettings(settings: WebDavSettings): string[] {
  const problems: string[] = [];
  try {
    const url = new URL(settings.url);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) problems.push('The address must start with https://, unless the NAS is on your home network.');
  } catch { problems.push('Enter the address of the NAS, such as https://nas.local:5006/photos.'); }
  if (!settings.username.trim()) problems.push('Enter the user name.');
  if (!settings.password) problems.push('Enter the password.');
  return problems;
}

/** The settings for an S3-compatible bucket. The keys belong in the system keychain, never in the project or in any sync file. */
export interface S3Settings { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; pathStyle?: boolean }

/** localhost, this computer, a .local name, or a private network address (10.x, 192.168.x, 172.16 to 31.x). */
export function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '[::1]' || /\.local$/i.test(host) || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

export function checkS3Settings(settings: S3Settings): string[] {
  const problems: string[] = [];
  try {
    const url = new URL(settings.endpoint);
    // Plain http is only for storage on this computer or the home network (a NAS, MinIO); anything on the internet must use https.
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) problems.push('The address must start with https://.');
  } catch { problems.push('Enter the storage address, such as https://s3.eu-west-2.amazonaws.com.'); }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(settings.bucket)) problems.push('The bucket name looks wrong. Use lower-case letters, numbers, dots and dashes.');
  if (!settings.region.trim()) problems.push('Enter the region, such as eu-west-2.');
  if (!settings.accessKeyId.trim() || !settings.secretAccessKey.trim()) problems.push('Enter both the access key and the secret key.');
  return problems;
}

/** An in-memory connector: used by tests, and a model of how every real one must behave (including refusing paths outside the root). */
export function memoryConnector(): StorageConnector & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const guard = (path: string) => { if (!isInsideSyncRoot(path)) throw new Error('Path is outside the InFlight folder.'); };
  return {
    kind: 'folder', files,
    test: async () => ({ ok: true }),
    put: async (path, bytes) => { if (!isWritablePath(path)) throw new Error('Path is outside the InFlight folder.'); files.set(path, bytes); },
    get: async (path) => { guard(path); return files.get(path) ?? null; },
    list: async (prefix) => { guard(prefix.replace(/\/+$/, '')); return [...files.keys()].filter((key) => key.startsWith(prefix)).sort(); },
    remove: async (path) => { guard(path); files.delete(path); },
  };
}
