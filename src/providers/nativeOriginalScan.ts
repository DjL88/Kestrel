/**
 * Bounded recursive directory scan for native desktop relinking.
 * Metadata only: never opens or copies original image bytes.
 * Symlinked directories are not followed, preventing mount loops.
 */
export interface NativeDirectoryEntry { name: string; isFile: boolean; isDirectory: boolean; isSymlink?: boolean }
export interface NativeFileStat { size: number; mtime?: Date | null }
export interface ScannedOriginal { path: string; name: string; size: number; lastModified: number }
export interface ScanResult { files: ScannedOriginal[]; truncated: boolean; skippedDirectories: number }

export async function scanOriginalFolder(
  root: string,
  readDir: (path: string) => Promise<NativeDirectoryEntry[]>,
  stat: (path: string) => Promise<NativeFileStat>,
  wantedNames: ReadonlySet<string>,
  limits: { maxEntries?: number; maxDepth?: number } = {},
): Promise<ScanResult> {
  const maxEntries = Math.max(1, limits.maxEntries ?? 20000);
  const maxDepth = Math.max(0, limits.maxDepth ?? 8);
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  const files: ScannedOriginal[] = [];
  let scanned = 0, skippedDirectories = 0, truncated = false;
  while (queue.length) {
    const current = queue.shift()!;
    let entries: NativeDirectoryEntry[];
    try { entries = await readDir(current.path); }
    catch { skippedDirectories++; continue; }
    for (const entry of entries) {
      if (scanned >= maxEntries) { truncated = true; break; }
      scanned++;
      if (entry.isSymlink) continue;
      const path = current.path.replace(/[\\/]+$/, '') + '/' + entry.name;
      if (entry.isDirectory) {
        if (current.depth < maxDepth) queue.push({ path, depth: current.depth + 1 });
        else skippedDirectories++;
      } else if (entry.isFile && wantedNames.has(entry.name.toLowerCase())) {
        try {
          const info = await stat(path);
          files.push({ path, name: entry.name, size: info.size, lastModified: info.mtime?.getTime() ?? 0 });
        } catch { /* Missing files and disconnected shares are recoverable. */ }
      }
    }
    if (truncated) break;
  }
  return { files, truncated, skippedDirectories };
}

/** Reject ambiguous duplicates instead of silently selecting the wrong original. */
export function matchScannedOriginals(
  expected: readonly { stableKey: string; filename: string; size: number; lastModified: number }[],
  candidates: readonly ScannedOriginal[],
): { matches: Map<string, string>; ambiguous: string[] } {
  const matches = new Map<string, string>(), ambiguous: string[] = [];
  for (const frame of expected) {
    const possible = candidates.filter((file) =>
      file.name.toLowerCase() === frame.filename.toLowerCase() &&
      file.size === frame.size && file.lastModified === frame.lastModified);
    if (possible.length === 1) matches.set(frame.stableKey, possible[0].path);
    else if (possible.length > 1) ambiguous.push(frame.stableKey);
  }
  return { matches, ambiguous };
}
