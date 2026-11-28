import { hashOriginalBytes, isSameOriginalBytes, type OriginalByteSource } from '../core/originalFileIdentity';

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
  limits: { maxEntries?: number; maxDepth?: number; stillCurrent?: () => boolean } = {},
): Promise<ScanResult> {
  const stillCurrent = limits.stillCurrent ?? (() => true);
  const cancelled = (): ScanResult => ({ files: [], truncated: false, skippedDirectories: 0 });
  const maxEntries = Math.max(1, limits.maxEntries ?? 20000);
  const maxDepth = Math.max(0, limits.maxDepth ?? 8);
  const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  const files: ScannedOriginal[] = [];
  let scanned = 0, skippedDirectories = 0, truncated = false;
  while (queue.length) {
    if (!stillCurrent()) return cancelled();
    const current = queue.shift()!;
    let entries: NativeDirectoryEntry[];
    try { entries = await readDir(current.path); }
    catch { skippedDirectories++; continue; }
    for (const entry of entries) {
      if (!stillCurrent()) return cancelled();
      if (scanned >= maxEntries) { truncated = true; break; }
      scanned++;
      // Directory APIs must not be allowed to escape the selected root via malformed names.
      if (entry.isSymlink || !entry.name || entry.name === '.' || entry.name === '..' ||
          entry.name.includes('/') || entry.name.includes('\\') || entry.name.includes(String.fromCharCode(0)) ||
          entry.name.includes(':')) continue;
      const path = current.path.replace(/[\\/]+$/, '') + '/' + entry.name;
      if (entry.isDirectory) {
        if (current.depth < maxDepth) queue.push({ path, depth: current.depth + 1 });
        else skippedDirectories++;
      } else if (entry.isFile && wantedNames.has(entry.name.toLowerCase())) {
        try {
          const info = await stat(path);
          if (!stillCurrent()) return cancelled();
          files.push({ path, name: entry.name, size: info.size, lastModified: info.mtime?.getTime() ?? 0 });
        } catch { /* Missing files and disconnected shares are recoverable. */ }
      }
    }
    if (truncated) break;
  }
  return stillCurrent() ? { files, truncated, skippedDirectories } : cancelled();
}

/** Legacy catalogues have no content hash. Use all the recorded metadata and
 * never assign an existing link's path or a name-and-size-only match. */
export function matchScannedOriginals(
  expected: readonly { stableKey: string; filename: string; size: number; lastModified: number }[],
  candidates: readonly ScannedOriginal[],
  connectedPaths: readonly string[] = [],
): { matches: Map<string, string>; ambiguous: string[] } {
  const pathKey = (path: string) => path.replace(/\\/g, '/').toLowerCase();
  const reserved = new Set(connectedPaths.map(pathKey));
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
    if (!Number.isSafeInteger(frame.size) || frame.size <= 0 || !Number.isFinite(frame.lastModified) || frame.lastModified <= 0) continue;
    const identity = JSON.stringify([frame.filename.toLowerCase(), frame.size, frame.lastModified]);
    const possible = byIdentity.get(identity) ?? [];
    if (possible.length === 1) {
      const path = possible[0].path;
      const key = pathKey(path);
      if (reserved.has(key)) {
        ambiguous.push(frame.stableKey);
        continue;
      }
      const claimant = claimedPaths.get(key);
      if (claimant && claimant !== frame.stableKey) {
        matches.delete(claimant);
        if (!ambiguous.includes(claimant)) ambiguous.push(claimant);
        ambiguous.push(frame.stableKey);
      } else {
        matches.set(frame.stableKey, path);
        claimedPaths.set(key, frame.stableKey);
      }
    } else if (possible.length > 1) ambiguous.push(frame.stableKey);
  }
  return { matches, ambiguous };
}

/**
 * Metadata narrows the relink candidates, but never proves they are the same photograph.
 * Read candidates in bounded SHA-256 chunks before changing a catalogue path. Keeping
 * verification injectable makes wrong-byte and disconnected-NAS paths testable offline.
 */
export interface ScannedOriginalRead {
  bytes: OriginalByteSource;
  /** Confirm source size/time did not change during fingerprinting. */
  unchanged(): Promise<boolean>;
  close(): Promise<void>;
}

export async function verifyScannedOriginalMatches(
  suggested: ReadonlyMap<string, string>,
  expected: readonly { stableKey: string; originalSha256?: string }[],
  open: (path: string) => Promise<ScannedOriginalRead>,
): Promise<{ matches: Map<string, string>; rejected: string[] }> {
  const saved = new Map<string, string | undefined>();
  const conflicting = new Set<string>();
  for (const frame of expected) {
    if (saved.has(frame.stableKey) && saved.get(frame.stableKey) !== frame.originalSha256) conflicting.add(frame.stableKey);
    saved.set(frame.stableKey, frame.originalSha256);
  }
  // A duplicate catalogue identity must never be resolved by last-write-wins.
  const claimedPaths = new Map<string, string>();
  const disputedPaths = new Set<string>();
  for (const [key, path] of suggested) {
    const normalized = path.replace(/\\/g, '/').toLowerCase();
    const prior = claimedPaths.get(normalized);
    if (prior && prior !== key) disputedPaths.add(normalized);
    claimedPaths.set(normalized, key);
  }
  const matches = new Map<string, string>();
  const rejected: string[] = [];
  // Sequential bounded reads avoid exhausting network shares with many large NEFs.
  for (const [key, path] of suggested) {
    const fingerprint = saved.get(key);
    if (conflicting.has(key) || disputedPaths.has(path.replace(/\\/g, '/').toLowerCase()) ||
        typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(fingerprint)) {
      rejected.push(key); // Legacy or damaged identity: require explicit re-import, not a guessed reconnect.
      continue;
    }
    let opened: ScannedOriginalRead | undefined;
    try {
      opened = await open(path);
      const actual = await hashOriginalBytes(opened.bytes);
      if (isSameOriginalBytes(fingerprint, actual) && await opened.unchanged()) matches.set(key, path);
      else rejected.push(key);
    } catch {
      // Missing NAS, read error, short range or changing original: leave edits and old path intact.
      rejected.push(key);
    } finally {
      if (opened) await opened.close().catch(() => undefined);
    }
  }
  return { matches, rejected };
}

/**
 * Reconnect a moved/restored folder by SHA, not its timestamp. A backup may
 * preserve exact bytes while changing mtime; equally, an attacker or NAS may
 * replace bytes without changing the metadata. A unique matching digest is
 * decisive, and duplicate matching paths stay ambiguous rather than guessed.
 */
export async function matchScannedOriginalsBySha(
  expected: readonly { stableKey: string; filename: string; size: number; originalSha256?: string }[],
  candidates: readonly ScannedOriginal[],
  connectedPaths: readonly string[],
  open: (path: string) => Promise<ScannedOriginalRead>,
  stillCurrent: () => boolean = () => true,
): Promise<{ matches: Map<string, string>; ambiguous: string[]; rejected: string[] }> {
  const cancelled = () => ({ matches: new Map<string, string>(), ambiguous: [], rejected: [] });
  if (!stillCurrent()) return cancelled();
  const pathKey = (path: string) => path.replace(/\\/g, '/').toLowerCase();
  const reserved = new Set(connectedPaths.map(pathKey));
  // Windows paths (a drive letter or a UNC share) name the same file whatever their case, so fold them; elsewhere a
  // case-sensitive NAS can hold BIRD.NEF and bird.NEF as different files, so only the exact path is one file.
  const fileKey = (path: string) => (/^[a-zA-Z]:[\\/]/.test(path) || /^[\\/]{2}[^\\/]/.test(path) ? pathKey(path) : path);
  const matches = new Map<string, string>();
  const ambiguous: string[] = [], rejected: string[] = [];
  // Each candidate original is read at most once per folder reselect, even if
  // several camera frames have the same filename and dimensions.
  const digests = new Map<string, string | null>();
  async function digestFor(candidate: ScannedOriginal): Promise<string | null> {
    // Cache by the file the path names: exact on a case-sensitive share, folded on Windows.
    const canonical = fileKey(candidate.path);
    if (digests.has(canonical)) return digests.get(canonical)!;
    let opened: ScannedOriginalRead | undefined;
    let digest: string | null = null;
    try {
      if (!stillCurrent()) return null;
      opened = await open(candidate.path);
      if (!stillCurrent()) return null;
      const source = opened.bytes;
      // A native read already in flight cannot always be interrupted, but never issue another
      // range read after the owner leaves this project. The finally block still closes the handle.
      const bytes: OriginalByteSource = {
        get size() { return source.size; },
        slice(start, end) {
          return { async arrayBuffer() {
            if (!stillCurrent()) throw new Error('Reconnect cancelled.');
            const buffer = await source.slice(start, end).arrayBuffer();
            if (!stillCurrent()) throw new Error('Reconnect cancelled.');
            return buffer;
          } };
        },
      };
      const actual = await hashOriginalBytes(bytes);
      if (stillCurrent() && await opened.unchanged() && stillCurrent()) digest = actual;
    } catch {
      // A disappearing file or corrupt range cannot serve as a replacement.
    } finally {
      if (opened) await opened.close().catch(() => undefined);
    }
    digests.set(canonical, digest);
    return digest;
  }

  const byPath = new Map<string, string>();
  const identities = new Map<string, string>();
  const conflicting = new Set<string>();
  for (const frame of expected) {
    const identity = JSON.stringify([frame.filename, frame.size, frame.originalSha256]);
    if (identities.has(frame.stableKey) && identities.get(frame.stableKey) !== identity) {
      conflicting.add(frame.stableKey);
    }
    identities.set(frame.stableKey, identity);
  }
  // Index once instead of filtering every scanned file for each photograph.
  const byNameAndSize = new Map<string, ScannedOriginal[]>();
  const candidateKey = (name: string, size: number) => JSON.stringify([name.toLowerCase(), size]);
  for (const file of candidates) {
    if (!stillCurrent()) return cancelled();
    if (reserved.has(pathKey(file.path))) continue;
    const key = candidateKey(file.name, file.size);
    const group = byNameAndSize.get(key) ?? [];
    group.push(file);
    byNameAndSize.set(key, group);
  }
  const seen = new Set<string>();
  for (const frame of expected) {
    if (!stillCurrent()) return cancelled();
    if (seen.has(frame.stableKey)) continue;
    seen.add(frame.stableKey);
    if (conflicting.has(frame.stableKey) ||
        !/^[a-f0-9]{64}$/.test(frame.originalSha256 ?? '') ||
        !Number.isSafeInteger(frame.size) || frame.size <= 0) {
      rejected.push(frame.stableKey);
      continue;
    }
    const possible = byNameAndSize.get(candidateKey(frame.filename, frame.size)) ?? [];
    const valid = new Map<string, string>();
    for (const candidate of possible) {
      if (!stillCurrent()) return cancelled();
      const digest = await digestFor(candidate);
      if (!stillCurrent()) return cancelled();
      if (digest === frame.originalSha256) valid.set(fileKey(candidate.path), candidate.path);
    }
    if (valid.size !== 1) {
      (valid.size > 1 ? ambiguous : rejected).push(frame.stableKey);
      continue;
    }
    const chosen = [...valid.values()][0], previous = byPath.get(pathKey(chosen));
    if (previous && previous !== frame.stableKey) {
      matches.delete(previous);
      if (!ambiguous.includes(previous)) ambiguous.push(previous);
      ambiguous.push(frame.stableKey);
    } else {
      matches.set(frame.stableKey, chosen);
      byPath.set(pathKey(chosen), frame.stableKey);
    }
  }
  return stillCurrent() ? { matches, ambiguous, rejected } : cancelled();
}

/** An existing path is not proof of identity. Only an explicit reconnect
 * hashes the existing linked files, sequentially and without holding whole
 * RAWs in memory. A substituted file at the old path must be eligible for
 * recovery from the selected backup folder. No catalogue mutations here. */
export async function resolveNativeOriginalRelinks(
  expected: readonly { stableKey: string; filename: string; sourcePath: string; size: number; originalSha256?: string }[],
  availablePaths: ReadonlySet<string>,
  scan: (wantedNames: ReadonlySet<string>) => Promise<ScanResult>,
  openCurrent: (path: string) => Promise<ScannedOriginalRead>,
  openCandidate: (candidate: ScannedOriginal) => Promise<ScannedOriginalRead>,
): Promise<{ connected: Map<string, string>; missing: string[]; matches: Map<string, string>; ambiguous: string[]; truncated: boolean; skippedDirectories: number }> {
  const suggested = new Map(expected.filter(frame => availablePaths.has(frame.sourcePath)).map(frame => [frame.stableKey, frame.sourcePath]));
  const checked = await verifyScannedOriginalMatches(suggested, expected, openCurrent);
  const unresolved = expected.filter(frame => !checked.matches.has(frame.stableKey));
  if (!unresolved.length) return { connected: checked.matches, missing: [], matches: new Map(), ambiguous: [], truncated: false, skippedDirectories: 0 };
  const found = await scan(new Set(unresolved.map(frame => frame.filename.toLowerCase())));
  const byPath = new Map(found.files.map(file => [file.path, file]));
  const candidates = await matchScannedOriginalsBySha(unresolved, found.files, [...checked.matches.values()], path => {
    const file = byPath.get(path);
    if (!file) throw new Error('Candidate no longer belongs to the selected folder scan.');
    return openCandidate(file);
  });
  return { connected: checked.matches, missing: unresolved.map(frame => frame.stableKey), matches: candidates.matches,
    ambiguous: candidates.ambiguous, truncated: found.truncated, skippedDirectories: found.skippedDirectories };
}
