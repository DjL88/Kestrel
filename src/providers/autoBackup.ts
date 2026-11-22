import { useEffect, useRef, useSyncExternalStore } from 'react';
import { afterAttempt, afterChange, backupFolder, backupName, backupsToDelete, dueForBackup, type BackupClock } from '../core/autoBackup';
import type { Health } from '../core/connections';
import { encodeProjectBackup } from '../core/projectBackup';
import type { CullingState } from '../core/types';
import { openConnection } from './connectionStore';
import { getLocations } from './projectLocations';
import { LOCAL_RECOVERY_TARGET, openDeviceRecovery, openSourceRecovery } from './automaticRecovery';

export interface BackupStatus { state: 'idle' | 'working' | 'ok' | 'partial' | 'failed'; at?: number; message?: string; health?: Health; to?: string }

const CLOCK_KEY = 'kestrel.backupclock.v1';
const clocks = new Map<string, BackupClock>();

/** The backup clock for a project. When the last backup finished is remembered across restarts, so opening a project that has not changed does not back it up again. */
function clockFor(projectId: string): BackupClock {
  const held = clocks.get(projectId);
  if (held) return held;
  let saved: Partial<BackupClock> = {};
  try {
    const stored = JSON.parse(localStorage.getItem(CLOCK_KEY) ?? '{}')[projectId];
    if (typeof stored === 'number' && Number.isFinite(stored)) {
      // Older clocks recorded completion only. Take one fresh snapshot rather than
      // assuming edits made during that write were included.
      saved = { lastBackupAt: stored, backedUpChangeAt: 0 };
    } else if (stored && Number.isFinite(stored.lastBackupAt) && Number.isFinite(stored.backedUpChangeAt)) {
      saved = { lastBackupAt: stored.lastBackupAt, backedUpChangeAt: stored.backedUpChangeAt };
    }
  } catch { /* none */ }
  const clock: BackupClock = { ...saved, failures: 0 };
  clocks.set(projectId, clock);
  return clock;
}
function rememberBackup(projectId: string, clock: BackupClock) {
  try {
    const all = JSON.parse(localStorage.getItem(CLOCK_KEY) ?? '{}');
    all[projectId] = { lastBackupAt: clock.lastBackupAt, backedUpChangeAt: clock.backedUpChangeAt };
    localStorage.setItem(CLOCK_KEY, JSON.stringify(all));
  } catch { /* remembered for this session only */ }
}
const inFlight = new Map<string, Promise<BackupStatus>>();
const statuses = new Map<string, BackupStatus>();
const listeners = new Set<() => void>();
let version = 0;
const setStatus = (projectId: string, status: BackupStatus) => { statuses.set(projectId, status); version += 1; listeners.forEach((listener) => listener()); };

/** A successful local recovery copy is independent of an optional source copy. */
async function writeSnapshot(connector: import('../core/storageConnectors').StorageConnector,
  projectId: string, name: string, payload: Uint8Array): Promise<void> {
  await connector.put(name, payload, '');
  // Retention is best effort; never report a valid backup as failed because
  // an old copy could not be removed from a disconnected drive.
  try {
    for (const expired of backupsToDelete(await connector.list(backupFolder(projectId)), projectId))
      await connector.remove(expired);
  } catch { /* Older snapshots may remain. */ }
}

/**
 * Save on-device *every time*, and also beside the original photo source
 * (or to the chosen backup location) when writable. This works on phones
 * connected to a network source just as it does on desktop.
 */
export async function backUpNow(state: CullingState, connectionId: string, now = new Date()): Promise<BackupStatus> {
  const projectId = state.shoot.id;
  const name = backupName(projectId, now);
  const payload = new TextEncoder().encode(encodeProjectBackup(state));
  const local = await openDeviceRecovery();
  let localOk = false;
  let localError = '';
  if ('problem' in local) localError = local.message;
  else {
    try { await writeSnapshot(local.connector, projectId, name, payload); localOk = true; }
    catch (error) { localError = error instanceof Error ? error.message : 'Device storage is unavailable.'; }
  }

  // Source and optional connection access are best effort. A missing,
  // disconnected or read-only folder must never interrupt normal editing.
  const source = await openSourceRecovery(state).catch(() => null);
  const failed: string[] = [];
  let selected: Awaited<ReturnType<typeof openConnection>> | null = null;
  if (connectionId !== LOCAL_RECOVERY_TARGET) {
    try { selected = await openConnection(connectionId); }
    catch { failed.push('Chosen backup location is temporarily unavailable.'); }
  }
  const extra: Array<{ connector: import('../core/storageConnectors').StorageConnector; to: string }> = [];
  if (source && !('problem' in source)) extra.push(source);
  if (selected && !('problem' in selected)) extra.push({ connector: selected.connector, to: 'Chosen backup location' });

  let extraOk = 0;
  if (selected && 'problem' in selected) failed.push('Chosen backup location is temporarily unavailable.');
  for (const target of extra) {
    try { await writeSnapshot(target.connector, projectId, name, payload); extraOk++; }
    catch (error) { failed.push(`${target.to}: ${error instanceof Error ? error.message : 'Not writable'}`); }
  }

  if (!localOk && !extraOk) return {
    state: 'failed', at: now.getTime(),
    message: [localError, ...failed].filter(Boolean).join(' ') || 'No recovery file could be written.',
  };
  // An unavailable network source must not cancel an otherwise valid local
  // snapshot, but it must remain visible and eligible for another attempt.
  if (failed.length || !localOk) return {
    state: 'partial', at: now.getTime(),
    to: localOk ? 'On this device' : extra.at(-1)?.to,
    message: localOk
      ? 'Saved locally. The folder copy could not be updated; InFlight will retry automatically.'
      : 'Saved alongside your photographs. Device recovery is unavailable; InFlight will retry automatically.',
  };
  return {
    state: 'ok', at: now.getTime(),
    to: extraOk ? extra.at(-1)?.to ?? 'Photo folder' : 'On this device',
  };
}

/** Observe edits even if a previous snapshot is still being written. */
function observeChange(state: CullingState): BackupClock {
  const clock = clockFor(state.shoot.id);
  const updated = afterChange(clock, Math.max(clock.lastChangeAt ?? 0, state.shoot.lastUpdatedAt ?? 0));
  clocks.set(state.shoot.id, updated);
  return updated;
}

function saveSnapshot(state: CullingState, target: string): Promise<BackupStatus> {
  const projectId = state.shoot.id;
  const pending = inFlight.get(projectId);
  if (pending) return pending.then(() => saveSnapshot(state, target));
  const savedChangeAt = state.shoot.lastUpdatedAt ?? 0;
  const task = Promise.resolve().then(async () => {
    setStatus(projectId, { ...statuses.get(projectId), state: 'working' });
    // A malformed snapshot or unexpected storage failure must never reject an
    // unattended save and interrupt the photographer's editing session.
    const result: BackupStatus = await backUpNow(state, target).catch(() => ({
      state: 'failed' as const,
      at: Date.now(),
      message: 'Automatic recovery could not be saved. Your project changes are still stored in InFlight.',
    }));
    // Read the latest clock, not the one from before the asynchronous write.
    const next = afterAttempt(clockFor(projectId), Date.now(), result.state === 'ok', savedChangeAt);
    clocks.set(projectId, next);
    if (result.state === 'ok') rememberBackup(projectId, next);
    setStatus(projectId, result);
    return result;
  }).finally(() => { inFlight.delete(projectId); });
  inFlight.set(projectId, task);
  return task;
}

/** Back up this project if it is due. `leaving` skips the usual gap, because the project is being closed. */
export async function maybeBackUp(state: CullingState, leaving = false): Promise<void> {
  const projectId = state.shoot.id;
  const target = getLocations(projectId).backUpTo ?? LOCAL_RECOVERY_TARGET;
  observeChange(state);
  const pending = inFlight.get(projectId);
  if (pending) {
    if (leaving) { await pending; await maybeBackUp(state, true); }
    return;
  }
  if (dueForBackup(clockFor(projectId), Date.now(), leaving) !== 'now') return;
  await saveSnapshot(state, target);
}

/** Back up right now, whatever the clock says (the "Back up now" button). */
export async function backUpProjectNow(state: CullingState): Promise<BackupStatus> {
  const projectId = state.shoot.id;
  const target = getLocations(projectId).backUpTo ?? LOCAL_RECOVERY_TARGET;
  observeChange(state);
  return saveSnapshot(state, target);
}

export function useBackupStatus(projectId: string): BackupStatus {
  useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => version, () => version);
  return statuses.get(projectId) ?? { state: 'idle' };
}

/**
 * Backs the open project up on its own: shortly after a change, no more often than the gap allows, and straight away
 * when the project is closed or another one opens. A place that cannot be reached is tried again later.
 */
export function useAutoBackup(state: CullingState, open: boolean) {
  const latest = useRef(state);
  latest.current = state;
  const projectId = state.shoot.id;
  useEffect(() => {
    if (!open) return;
    // A change is a real edit: the project's own last-edited time moving on, not the project merely being opened.
    const clock = clockFor(projectId);
    clocks.set(projectId, afterChange(clock, Math.max(clock.lastChangeAt ?? 0, state.shoot.lastUpdatedAt ?? 0)));
    const soon = window.setTimeout(() => void maybeBackUp(latest.current), 1500);
    return () => window.clearTimeout(soon);
  }, [state, open, projectId]);
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => void maybeBackUp(latest.current), 30_000);
    const hide = () => { if (document.visibilityState === 'hidden') void maybeBackUp(latest.current, true); };
    document.addEventListener('visibilitychange', hide);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', hide); void maybeBackUp(latest.current, true); };
  }, [open, projectId]);
}
