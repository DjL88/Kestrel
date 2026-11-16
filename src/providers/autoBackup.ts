import { useEffect, useRef, useSyncExternalStore } from 'react';
import { afterAttempt, afterChange, backupFolder, backupName, backupsToDelete, dueForBackup, type BackupClock } from '../core/autoBackup';
import type { Health } from '../core/connections';
import { syncNameFor } from '../core/projectSnapshot';
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
  let lastBackupAt: number | undefined;
  try { const stored = (JSON.parse(localStorage.getItem(CLOCK_KEY) ?? '{}') as Record<string, number>)[projectId]; if (Number.isFinite(stored)) lastBackupAt = stored; } catch { /* none */ }
  const clock: BackupClock = { failures: 0, ...(lastBackupAt !== undefined ? { lastBackupAt } : {}) };
  clocks.set(projectId, clock);
  return clock;
}
function rememberBackup(projectId: string, at: number) {
  try { const all = JSON.parse(localStorage.getItem(CLOCK_KEY) ?? '{}') as Record<string, number>; all[projectId] = at; localStorage.setItem(CLOCK_KEY, JSON.stringify(all)); } catch { /* remembered for this session only */ }
}
const statuses = new Map<string, BackupStatus>();
const listeners = new Set<() => void>();
let version = 0;
const setStatus = (projectId: string, status: BackupStatus) => { statuses.set(projectId, status); version += 1; listeners.forEach((listener) => listener()); };

/** Save a backup of the project to a connection now, and tidy old ones. Never throws: the answer says what happened. */
export async function backUpNow(state: CullingState, connectionId: string, now = new Date()): Promise<BackupStatus> {
  const opened = await openConnection(connectionId);
  if ('problem' in opened) return { state: 'failed', message: opened.message, health: opened.problem, at: now.getTime() };
  const slug = syncNameFor(state.shoot.title);
  try {
    await opened.connector.put(backupName(slug, now), new TextEncoder().encode(encodeProjectBackup(state)), '');
    // Keep the newest few. A tidy-up that fails is not a failed backup.
    try { for (const name of backupsToDelete(await opened.connector.list(backupFolder(slug)), slug)) await opened.connector.remove(name); } catch { /* old copies stay */ }
    return { state: 'ok', at: now.getTime() };
  } catch (error) {
    return { state: 'failed', message: error instanceof Error ? error.message : 'The backup could not be saved.', at: now.getTime() };
  }
}

/** Back up this project if it is due. `leaving` skips the usual gap, because the project is being closed. */
export async function maybeBackUp(state: CullingState, leaving = false): Promise<void> {
  const projectId = state.shoot.id;
  const target = getLocations(projectId).backUpTo;
  if (!target) return;
  const clock = clockFor(projectId);
  if (dueForBackup(clock, Date.now(), leaving) !== 'now') return;
  setStatus(projectId, { ...statuses.get(projectId), state: 'working' });
  const result = await backUpNow(state, target);
  clocks.set(projectId, afterAttempt(clock, Date.now(), result.state === 'ok'));
  if (result.state === 'ok') rememberBackup(projectId, Date.now());
  setStatus(projectId, result);
}

/** Back up right now, whatever the clock says (the "Back up now" button). */
export async function backUpProjectNow(state: CullingState): Promise<BackupStatus> {
  const projectId = state.shoot.id;
  const target = getLocations(projectId).backUpTo;
  if (!target) { const none: BackupStatus = { state: 'failed', message: 'Choose where to back this project up first.' }; setStatus(projectId, none); return none; }
  setStatus(projectId, { ...statuses.get(projectId), state: 'working' });
  const result = await backUpNow(state, target);
  clocks.set(projectId, afterAttempt(clockFor(projectId), Date.now(), result.state === 'ok'));
  if (result.state === 'ok') rememberBackup(projectId, Date.now());
  setStatus(projectId, result);
  return result;
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
