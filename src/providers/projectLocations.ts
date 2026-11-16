import { useSyncExternalStore } from 'react';
import { cleanLocations, type ProjectLocations } from '../core/connections';
import { connections } from './connectionStore';

/**
 * Where each project loads from, saves to and backs up to. Kept on this device (not inside the project), because a
 * work shared drive has a different address on every computer, and a backup restored elsewhere must not point nowhere.
 */
const KEY = 'kestrel.locations.v1';
const listeners = new Set<() => void>();
let version = 0;

function readAll(): Record<string, ProjectLocations> {
  try { const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown; return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, ProjectLocations> : {}; } catch { return {}; }
}

/** This project's choices, with any connection that has since been removed left out. */
export const getLocations = (projectId: string): ProjectLocations => cleanLocations(readAll()[projectId], connections());

export function setLocations(projectId: string, locations: ProjectLocations): void {
  const all = readAll();
  const clean = cleanLocations(locations, connections());
  if (Object.keys(clean).length) all[projectId] = clean; else delete all[projectId];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* kept for this session only */ }
  version += 1;
  listeners.forEach((listener) => listener());
}

export function useProjectLocations(projectId: string): ProjectLocations {
  useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => version, () => version);
  return getLocations(projectId);
}
