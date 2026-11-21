import type { S3Settings } from '../core/storageConnectors';

const KEY = 'kestrel.cloud.v1';
/** Credentials are session-only until an OS keychain integration is available. */
let session: S3Settings | null = null;

// Remove plaintext credentials left by previous versions even if this form is never opened.
try { localStorage.removeItem(KEY); } catch { /* browser storage may be unavailable */ }

/** Never reload secrets from persistent browser storage. */
export function loadCloudSettings(): S3Settings | null {
  try { localStorage.removeItem(KEY); } catch { /* unavailable */ }
  return session;
}

/** Persistent credential remembering is disabled until a native secure store exists. */
export const isCloudRemembered = () => false;

/** Keep connection credentials only in memory for this session. */
export function saveCloudSettings(settings: S3Settings, remember: boolean): void {
  session = settings;
  void remember;
  try { localStorage.removeItem(KEY); } catch { /* session only */ }
}

export function forgetCloudSettings(): void {
  session = null;
  try { localStorage.removeItem(KEY); } catch { /* nothing to remove */ }
}
