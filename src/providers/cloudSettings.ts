import type { S3Settings } from '../core/storageConnectors';

const KEY = 'kestrel.cloud.v1';
// Purge legacy plaintext credentials even when the user never opens cloud settings.
try { localStorage.removeItem(KEY); } catch { /* storage may be unavailable */ }
/** Save only in process memory; ignore legacy remember requests. */
export function saveCloudSettings(settings: S3Settings, remember: boolean): void {
  session = settings;
  void remember;
  try { localStorage.removeItem(KEY); } catch { /* session only */ }
}

export function forgetCloudSettings(): void {
  session = null;
  try { localStorage.removeItem(KEY); } catch { /* nothing to remove */ }
}
