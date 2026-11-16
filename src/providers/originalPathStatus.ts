/**
 * A linked original can be registered without being readable. This module
 * checks the saved path without loading the RAW into memory.
 * Missing/disconnected drives are recoverable: never delete catalogue data.
 */
export type OriginalPathState = 'available' | 'missing' | 'permission-denied' | 'unavailable';

export function classifyOriginalPathError(error: unknown): Exclude<OriginalPathState, 'available'> {
  const value = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
  const code = typeof value.code === 'string' ? value.code.toLowerCase() : '';
  const message = typeof value.message === 'string' ? value.message.toLowerCase() : '';
  if (code === 'enoent' || code === 'notfound' || /not found|no such file|cannot find the (file|path)/.test(message)) return 'missing';
  if (code === 'eacces' || code === 'eperm' || /permission denied|access is denied|not permitted/.test(message)) return 'permission-denied';
  // Includes disconnected SMB/NAS mounts, timeouts, and unknown Tauri errors.
  return 'unavailable';
}

export async function checkOriginalPath(
  path: string,
  stat: (path: string) => Promise<{ isFile: boolean }>,
): Promise<OriginalPathState> {
  if (!path.trim()) return 'missing';
  try {
    const info = await stat(path);
    return info.isFile ? 'available' : 'missing';
  } catch (error) {
    return classifyOriginalPathError(error);
  }
}

/** Bounded, order-preserving checks: never read the original image bytes. */
export async function checkOriginalPaths(
  paths: readonly string[],
  stat: (path: string) => Promise<{ isFile: boolean }>,
  concurrency = 8,
): Promise<Map<string, OriginalPathState>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const results = new Map<string, OriginalPathState>();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, Math.floor(concurrency) || 1), unique.length) }, async () => {
    while (cursor < unique.length) {
      const path = unique[cursor++];
      results.set(path, await checkOriginalPath(path, stat));
    }
  });
  await Promise.all(workers);
  return results;
}
