/**
 * When to back a project up on its own. A backup is a small file of the project's decisions, edits and settings (never
 * photographs) saved to the place the person chose. It runs after changes, not too often, at once when leaving the
 * project, and tries again later if the place is not reachable. Nothing local is ever lost because a backup failed.
 */
import { sha256Plain } from './sha256';
import { SYNC_ROOT } from './storageConnectors';

export interface BackupClock {
  /** When the project last changed on this device. */
  lastChangeAt?: number;
  /** When a backup last finished. */
  lastBackupAt?: number;
  /** Last edit included in the successful snapshot, which can precede completion. */
  backedUpChangeAt?: number;
  /** When the last try was made, and how many in a row have failed. */
  lastAttemptAt?: number;
  failures: number;
}

export const MIN_GAP_MS = 5 * 60_000;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 30 * 60_000;
export const KEEP_BACKUPS = 10;

/** How long to wait after this many failures in a row: a minute, then double each time, up to half an hour. */
export const retryDelay = (failures: number) => (failures <= 0 ? 0 : Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS));

export type Due = 'nothing' | 'wait' | 'now';

/**
 * Whether to back up now. `leaving` is true when the person is closing the project: the usual gap is skipped, but a
 * place that has been failing is still not hammered.
 */
export function dueForBackup(clock: BackupClock, now: number, leaving = false): Due {
  if (clock.lastChangeAt === undefined) return 'nothing';
  if (clock.lastBackupAt !== undefined && clock.lastChangeAt <= (clock.backedUpChangeAt ?? clock.lastBackupAt)) return 'nothing';
  if (clock.lastAttemptAt !== undefined && now - clock.lastAttemptAt < retryDelay(clock.failures)) return 'wait';
  if (!leaving && clock.lastBackupAt !== undefined && now - clock.lastBackupAt < MIN_GAP_MS) return 'wait';
  return 'now';
}

export const afterAttempt = (clock: BackupClock, now: number, ok: boolean, savedChangeAt = clock.lastChangeAt ?? 0): BackupClock =>
  ok ? { ...clock, lastBackupAt: now, backedUpChangeAt: Math.max(clock.backedUpChangeAt ?? 0, savedChangeAt), lastAttemptAt: now, failures: 0 } : { ...clock, lastAttemptAt: now, failures: clock.failures + 1 };

export const afterChange = (clock: BackupClock, now: number): BackupClock => ({ ...clock, lastChangeAt: now });

const stamp = (date: Date) => date.toISOString().replace(/[:.]/g, '-');

/** Stable across renames and safe on case-insensitive disks. Legacy title folders are left for manual restore. */
export function backupFolder(projectId: string): string {
  if (!projectId) throw new Error('The project needs an identity before it can be backed up.');
  const identity = sha256Plain(new TextEncoder().encode(JSON.stringify(projectId)));
  return `${SYNC_ROOT}/project-backups/${identity}`;
}

/** Separate files even when two saves start in the same millisecond or on different devices. */
export function backupName(projectId: string, now: Date): string {
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${backupFolder(projectId)}/${stamp(now)}_${nonce}.kestrel.json`;
}

const BACKUP_FILE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[a-f0-9]{32}\.kestrel\.json$/;

/** Which old backups to delete so only the newest few are kept. Only files that look like Kite44 backups are ever named. */
export function backupsToDelete(names: readonly string[], projectId: string, keep = KEEP_BACKUPS): string[] {
  const prefix = `${backupFolder(projectId)}/`;
  const ours = [...new Set(names)].filter((name) => name.startsWith(prefix) && BACKUP_FILE.test(name.slice(prefix.length))).sort();
  return ours.slice(0, Math.max(0, ours.length - keep));
}

/** "5 minutes ago", for the status line. */
export function ago(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} hour${hours === 1 ? '' : 's'} ago` : `${Math.round(hours / 24)} days ago`;
}
