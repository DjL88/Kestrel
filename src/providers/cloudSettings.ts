import type { S3Settings } from '../core/storageConnectors';

const KEY = 'kestrel.cloud.v1';
/** Kept for this session only unless the person chooses to remember them. */
let session: S3Settings | null = null;

const valid = (value: unknown): value is S3Settings => {
  const v = value as Partial<S3Settings> | null;
  return Boolean(v && typeof v.endpoint === 'string' && typeof v.region === 'string' && typeof v.bucket === 'string' && typeof v.accessKeyId === 'string' && typeof v.secretAccessKey === 'string');
};

/** The person's storage details: this session's, or the ones they chose to remember on this device. */
export function loadCloudSettings(): S3Settings | null {
  if (session) return session;
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    return valid(stored) ? stored : null;
  } catch {
    return null;
  }
}

export const isCloudRemembered = () => { try { return localStorage.getItem(KEY) !== null; } catch { return false; } };

/**
 * Use these details now, and keep them on this device only when asked. The secret key is then stored unencrypted in the
 * app's own storage, so the screen advises a key that can reach one bucket only.
 */
export function saveCloudSettings(settings: S3Settings, remember: boolean): void {
  session = settings;
  try { if (remember) localStorage.setItem(KEY, JSON.stringify(settings)); else localStorage.removeItem(KEY); } catch { /* session only */ }
}

export function forgetCloudSettings(): void {
  session = null;
  try { localStorage.removeItem(KEY); } catch { /* nothing to remove */ }
}
