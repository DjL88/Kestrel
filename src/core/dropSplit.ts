export interface DropFrame { stableKey: string; sourceKind?: string; removedAt?: number | string | null }

/**
 * Sort dropped photos for an open project: the ones that are the project's own missing originals (to reconnect),
 * the ones already in the project with their original present (to ignore) and the rest (new photos to add).
 */
export function splitDropped<F extends { name: string }>(files: F[], frames: DropFrame[], keyOf: (file: F) => string, hasOriginal: (stableKey: string) => boolean) {
  const active = frames.filter((frame) => frame.removedAt == null);
  const present = new Set(active.map((frame) => frame.stableKey));
  const missing = new Set(active.filter((frame) => frame.sourceKind === 'file' && !hasOriginal(frame.stableKey)).map((frame) => frame.stableKey));
  const reconnect = files.filter((file) => missing.has(keyOf(file)));
  const add = files.filter((file) => !present.has(keyOf(file)));
  return { reconnect, add, ignored: files.length - new Set([...reconnect, ...add]).size };
}
