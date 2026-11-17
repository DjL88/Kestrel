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
): { matches: Map<string, string>; ambiguous: string[]; approximate: string[] } {
  const approximate: string[] = [];
  const matches = new Map<string, string>(), ambiguous: string[] = [];
  const byIdentity = new Map<string, ScannedOriginal[]>();
  for (const candidate of candidates) {
    const identity = JSON.stringify([candidate.name.toLowerCase(), candidate.size, candidate.lastModified]);
    const group = byIdentity.get(identity) ?? [];
    group.push(candidate);
    byIdentity.set(identity, group);
  }
  const claimedPaths = new Map<string, string>();
  for (const frame of expected) {
    const identity = JSON.stringify([frame.filename.toLowerCase(), frame.size, frame.lastModified]);
    const possible = byIdentity.get(identity) ?? [];
    if (possible.length === 1) {
      const path = possible[0].path;
      const claimant = claimedPaths.get(path.toLowerCase());
      if (claimant && claimant !== frame.stableKey) {
        matches.delete(claimant);
        if (!ambiguous.includes(claimant)) ambiguous.push(claimant);
        ambiguous.push(frame.stableKey);
      } else {
        matches.set(frame.stableKey, path);
        claimedPaths.set(path.toLowerCase(), frame.stableKey);
      }
    } else if (possible.length > 1) ambiguous.push(frame.stableKey);
  }
  // Second pass for what is still unmatched: a file copied, re-downloaded or exported again keeps its name and size but gets a
  // new modified time. Accept it only when exactly one candidate and exactly one missing photo share that name and size,
  // and say so, so it can never quietly pick the wrong file.
  const nameSize = (name: string, size: number) => JSON.stringify([name.toLowerCase(), size]);
  const candidatesByNameSize = new Map<string, ScannedOriginal[]>();
  for (const candidate of candidates) {
    const key = nameSize(candidate.name, candidate.size);
    candidatesByNameSize.set(key, [...(candidatesByNameSize.get(key) ?? []), candidate]);
  }
  const waiting = expected.filter((frame) => !matches.has(frame.stableKey) && !ambiguous.includes(frame.stableKey));
  const waitingCount = new Map<string, number>();
  for (const frame of waiting) waitingCount.set(nameSize(frame.filename, frame.size), (waitingCount.get(nameSize(frame.filename, frame.size)) ?? 0) + 1);
  for (const frame of waiting) {
    const key = nameSize(frame.filename, frame.size);
    const possible = candidatesByNameSize.get(key) ?? [];
    if (possible.length !== 1 || waitingCount.get(key) !== 1 || claimedPaths.has(possible[0].path.toLowerCase())) continue;
    matches.set(frame.stableKey, possible[0].path);
    claimedPaths.set(possible[0].path.toLowerCase(), frame.stableKey);
    approximate.push(frame.stableKey);
  }
  return { matches, ambiguous, approximate };
}
