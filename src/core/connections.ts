/**
 * Places a person keeps their work: a folder on this computer or a shared drive, their own S3-compatible storage, and
 * later Dropbox and Google Drive. Each is a saved connection with a health, so a lost link or an expired sign-in is
 * noticed and explained instead of failing quietly. Each project then chooses where it loads from, saves to and
 * backs up to, so work on a shared drive and personal photographs can live in different places.
 */
export type ProviderKind = 'folder' | 's3' | 'webdav' | 'dropbox' | 'googledrive' | 'onedrive';

export const PROVIDERS: { kind: ProviderKind; label: string; short: string; available: boolean; note?: string }[] = [
  { kind: 'folder', label: 'A folder (including iCloud Drive, OneDrive or Dropbox on this computer, a shared drive, or a NAS mounted as a drive)', short: 'Folder', available: true },
  { kind: 'webdav', label: 'A NAS or server over WebDAV (Synology, QNAP, Nextcloud, ownCloud and others)', short: 'NAS / WebDAV', available: true },
  { kind: 's3', label: 'My cloud storage (S3-compatible: Amazon S3, Backblaze, Cloudflare R2, Wasabi, MinIO)', short: 'Cloud storage', available: true },
  { kind: 'dropbox', label: 'Dropbox', short: 'Dropbox', available: false, note: 'Not set up in this build yet. Until then, use the Dropbox folder on your computer.' },
  { kind: 'googledrive', label: 'Google Drive', short: 'Google Drive', available: false, note: 'Not set up in this build yet. Until then, use the Drive folder on your computer.' },
  { kind: 'onedrive', label: 'Microsoft OneDrive', short: 'OneDrive', available: false, note: 'Not set up in this build yet. Until then, use the OneDrive folder on your computer.' },
];

export interface Connection {
  id: string;
  kind: ProviderKind;
  /** The name the person gave it, such as "Work shared drive". */
  label: string;
  /** Where it points, for display: a bucket and address, or a folder name. Never a secret. */
  detail: string;
}

/** What state a connection is in, in words a person can act on. */
export type Health = 'unknown' | 'ok' | 'needs-signin' | 'offline' | 'missing' | 'error';

export interface HealthReport { health: Health; message: string; checkedAt: number }

export const HEALTH_TEXT: Record<Health, { word: string; advice: string }> = {
  unknown: { word: 'Not checked', advice: 'Check the connection.' },
  ok: { word: 'Connected', advice: '' },
  'needs-signin': { word: 'Sign in again', advice: 'The sign-in or keys are no longer accepted. Reconnect to carry on.' },
  offline: { word: 'Offline', advice: 'InFlight cannot reach it right now. Check your connection; your work is safe here.' },
  missing: { word: 'Not found', advice: 'The folder or drive is not there. Plug it in, or choose it again.' },
  error: { word: 'Problem', advice: 'Something is wrong with this connection. Open it to see what.' },
};

/** Where one project loads from, saves to and backs up to. Each is a connection id, or unset for "this device only". */
export interface ProjectLocations { loadFrom?: string; saveTo?: string; backUpTo?: string; exportTo?: string }

export type Role = keyof ProjectLocations;
export const ROLE_LABEL: Record<Role, string> = { loadFrom: 'Load from', saveTo: 'Save to', backUpTo: 'Back up to', exportTo: 'Also save exports to' };

/** Turn a failed request into a health. 401 and 403 mean the sign-in or keys; no answer means offline; 404 means gone. */
export function healthFromFailure(failure: { status?: number; network?: boolean; missing?: boolean }): Health {
  if (failure.missing) return 'missing';
  if (failure.network) return 'offline';
  if (failure.status === 401 || failure.status === 403) return 'needs-signin';
  if (failure.status === 404) return 'missing';
  return 'error';
}

/** Keep only connection ids that still exist, so a deleted connection never leaves a project pointing at nothing. */
export function cleanLocations(locations: ProjectLocations | undefined, connections: readonly Connection[]): ProjectLocations {
  const ids = new Set(connections.map((connection) => connection.id));
  const out: ProjectLocations = {};
  for (const role of Object.keys(ROLE_LABEL) as Role[]) { const id = locations?.[role]; if (id && ids.has(id)) out[role] = id; }
  return out;
}

/** The connections a project could use, for choosing: all of them, best-looking first (working ones before broken ones). */
export function choosable(connections: readonly Connection[], reports: Readonly<Record<string, HealthReport | undefined>>): Connection[] {
  const rank = (c: Connection) => (reports[c.id]?.health === 'ok' ? 0 : reports[c.id] ? 2 : 1);
  return [...connections].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/** Short plain sentence for a project's choices, or why something needs attention. */
export function describeLocations(locations: ProjectLocations, connections: readonly Connection[], reports: Readonly<Record<string, HealthReport | undefined>>): string[] {
  const lines: string[] = [];
  for (const role of Object.keys(ROLE_LABEL) as Role[]) {
    const connection = connections.find((c) => c.id === locations[role]);
    if (!connection) { lines.push(`${ROLE_LABEL[role]}: this device only`); continue; }
    const report = reports[connection.id];
    const state = report && report.health !== 'ok' ? ` (${HEALTH_TEXT[report.health].word})` : '';
    lines.push(`${ROLE_LABEL[role]}: ${connection.label}${state}`);
  }
  return lines;
}

/** Make a short unique id for a new connection. */
export const newConnectionId = (random = Math.random) => `c-${Math.floor(random() * 0xffffffff).toString(36)}${Date.now().toString(36)}`;
