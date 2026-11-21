/**
 * Portable, fail-closed restore preflight. This module performs NO writes.
 * A platform adapter must stage privately, fsync, and atomically publish only
 * after this complete proof; never restore over an existing original.
 */
export interface BackupEntry {
  path: string;
  byteLength: number;
  sha256: string;
}
export interface BackupManifest {
  format: 'kestrel-portable-backup';
  version: 1;
  entries: readonly BackupEntry[];
}
export interface VerifiedRestoreEntry extends BackupEntry {
  /** Normalised relative path, never an absolute destination. */
  relativePath: string;
}
const SHA256 = /^[a-f0-9]{64}$/;
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_FILES = 100_000;
const MAX_BYTES = 2 ** 53 - 1;

export function safeBackupPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1024 ||
      value !== value.normalize('NFC') || value.includes('\\') ||
      value.startsWith('/') || /^[A-Za-z]:/.test(value) ||
      /[\u0000-\u001f\u007f]/.test(value)) throw new Error('unsafe-backup-path');
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' ||
      part.endsWith('.') || part.endsWith(' ') || part.includes(':') ||
      RESERVED.test(part))) throw new Error('unsafe-backup-path');
  return parts.join('/');
}

/** Validates every path before any bytes are loaded or destination touched. */
export function planBackupRestore(manifest: BackupManifest): readonly VerifiedRestoreEntry[] {
  if (!manifest || manifest.format !== 'kestrel-portable-backup' ||
      manifest.version !== 1 || !Array.isArray(manifest.entries) ||
      manifest.entries.length > MAX_FILES) throw new Error('unsupported-backup-manifest');
  const seen = new Set<string>();
  let total = 0;
  const entries = manifest.entries.map(entry => {
    const relativePath = safeBackupPath(entry?.path);
    const key = relativePath.toLowerCase();
    if (seen.has(key)) throw new Error('duplicate-backup-path');
    seen.add(key);
    if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0 ||
        !SHA256.test(entry.sha256)) throw new Error('invalid-backup-entry');
    total += entry.byteLength;
    if (!Number.isSafeInteger(total) || total > MAX_BYTES) throw new Error('backup-too-large');
    return Object.freeze({ path: relativePath, relativePath,
      byteLength: entry.byteLength, sha256: entry.sha256 });
  });
  // A file cannot also be an ancestor directory of another file.
  for (const key of seen) {
    const parts = key.split('/');
    for (let i = 1; i < parts.length; i++)
      if (seen.has(parts.slice(0, i).join('/'))) throw new Error('backup-file-directory-collision');
  }
  return Object.freeze(entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath)));
}

/**
 * Verify all declared bytes and reject undeclared paths. The adapter must
 * guarantee readFile reads ordinary files without following symlinks and must
 * reverify source identities before committing staged output.
 */
export async function verifyBackupRestore(
  manifest: BackupManifest,
  adapter: {
    listPaths(): Promise<readonly string[]>;
    readFile(path: string): Promise<Uint8Array>;
    sha256(bytes: Uint8Array): Promise<string>;
  },
  signal?: AbortSignal,
): Promise<readonly VerifiedRestoreEntry[]> {
  const plan = planBackupRestore(manifest);
  if (signal?.aborted) throw new Error('restore-cancelled');
  const available = await adapter.listPaths();
  if (signal?.aborted) throw new Error('restore-cancelled');
  const actual = new Set<string>();
  for (const path of available) {
    const key = safeBackupPath(path).toLowerCase();
    if (actual.has(key)) throw new Error('duplicate-archive-entry');
    actual.add(key);
  }
  const expected = new Set(plan.map(entry => entry.relativePath.toLowerCase()));
  if (actual.size !== expected.size || [...actual].some(path => !expected.has(path)))
    throw new Error('backup-entry-set-mismatch');
  for (const entry of plan) {
    if (signal?.aborted) throw new Error('restore-cancelled');
    const bytes = await adapter.readFile(entry.relativePath);
    if (signal?.aborted) throw new Error('restore-cancelled');
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== entry.byteLength ||
        await adapter.sha256(bytes) !== entry.sha256) throw new Error('backup-content-mismatch');
    if (signal?.aborted) throw new Error('restore-cancelled');
  }
  return plan;
}
