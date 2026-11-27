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

const OWN_KEY = 'inflight.ownCloudProjects.v1';
function readOwn(): string[] {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(OWN_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

/**
 * This device's project was put in the cloud by "Store in the cloud", for the person's own devices. It is linked like a
 * shared project (the cloud photo store is the same), but nobody was invited, so it is not shown as shared.
 */
export function isOwnCloudProject(localProjectId: string): boolean { return readOwn().includes(localProjectId); }

export function markOwnCloudProject(localProjectId: string): void {
  try { globalThis.localStorage?.setItem(OWN_KEY, JSON.stringify([...new Set([...readOwn(), localProjectId])])); } catch { /* not remembered: the project only shows as shared on this device */ }
}
