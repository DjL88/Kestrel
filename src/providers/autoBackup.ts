import { useEffect, useRef, useSyncExternalStore } from 'react';
import { afterAttempt, afterChange, backupFolder, backupName, backupsToDelete, dueForBackup, type BackupClock } from '../core/autoBackup';
import type { Health } from '../core/connections';
import { encodeProjectBackup } from '../core/projectBackup';
import type { CullingState } from '../core/types';
import { openConnection } from './connectionStore';
import { getLocations } from './projectLocations';

export interface BackupStatus { state: 'idle' | 'working' | 'ok' | 'failed'; at?: number; message?: string; health?: Health; to?: string }

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

/** Save a backup of the project to a connection now, and tidy old ones. Never throws: the answer says what happened. */
export async function backUpNow(state: CullingState, connectionId: string, now = new Date()): Promise<BackupStatus> {
  const projectId = state.shoot.id;
  try {
    const opened = await openConnection(connectionId);
    if ('problem' in opened) return { state: 'failed', message: opened.message, health: opened.problem, at: now.getTime() };
    await opened.connector.put(backupName(projectId, now), new TextEncoder().encode(encodeProjectBackup(state)), '');
    // Keep the newest few. A tidy-up that fails is not a failed backup.
    try { for (const name of backupsToDelete(await opened.connector.list(backupFolder(projectId)), projectId)) await opened.connector.remove(name); } catch { /* old copies stay */ }
    return { state: 'ok', at: now.getTime() };
  } catch (error) {
    return { state: 'failed', message: error instanceof Error ? error.message : 'The backup could not be saved.', at: now.getTime() };
  }
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
    const result = await backUpNow(state, target);
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
  const target = getLocations(projectId).backUpTo;
  if (!target) return;
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
  const target = getLocations(projectId).backUpTo;
  if (!target) { const none: BackupStatus = { state: 'failed', message: 'Choose where to back this project up first.' }; setStatus(projectId, none); return none; }
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
