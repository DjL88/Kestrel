import type { BackupStatus } from '../../providers/autoBackup';
import { STRINGS } from '../ui/strings';

/** A clock time in the person's own format, for "Last backed up 14:05". */
export function backupTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** What a backup did, in plain words in the person's language. A failure never says the project was lost. */
export function backupStatusText(status: Pick<BackupStatus, 'state' | 'at'>): string {
  switch (status.state) {
    case 'working': return STRINGS.backup.working;
    case 'ok': return STRINGS.backup.ok(backupTime(status.at ?? Date.now()));
    case 'partial': return STRINGS.backup.partial;
    case 'failed': return STRINGS.backup.failed;
    default: return STRINGS.backup.idle;
  }
}
