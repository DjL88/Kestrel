/**
 * Which shared project this device's project is linked to. A per-device convenience: losing it only means opening
 * Share again (the shared project lists you as a member), so it lives in browser storage and every access is guarded.
 */
const KEY = 'inflight.sharedProjects.v1';

function readAll(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch { return {}; }
}

export function readSharedLink(localProjectId: string): string | null {
  const value = readAll()[localProjectId];
  return typeof value === 'string' && value ? value : null;
}

export function writeSharedLink(localProjectId: string, sharedProjectId: string): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify({ ...readAll(), [localProjectId]: sharedProjectId })); } catch { /* storage unavailable: the link is simply not remembered */ }
}
