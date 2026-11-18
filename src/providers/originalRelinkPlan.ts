/**
 * Pure, offline folder-relink planning. No filesystem writes or implicit moves.
 * Match using the original relative path and file metadata; never trust a
 * filename alone, particularly when several cameras use similar names.
 */
export interface SavedOriginal {
  id: string;
  path: string;
  size: number;
  lastModified: number;
}
export interface CandidateOriginal {
  path: string;
  size: number;
  lastModified: number;
}
export interface RelinkMatch {
  id: string;
  path: string;
}
export interface RelinkPlan {
  matches: RelinkMatch[];
  unresolved: string[];
  ambiguous: string[];
}

const separators = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');
const filename = (path: string) => separators(path).split('/').at(-1)?.toLowerCase() ?? '';
const suffix = (path: string) => separators(path).toLowerCase();

export function planOriginalRelink(
  originals: readonly SavedOriginal[],
  candidates: readonly CandidateOriginal[],
): RelinkPlan {
  const matches: RelinkMatch[] = [], unresolved: string[] = [], ambiguous: string[] = [];
  const claimed = new Set<string>();
  for (const original of originals) {
    // Never turn an incomplete catalogue record into a guessed original link.
    // A blank path has no filename, and missing metadata (NaN/Infinity or
    // negative byte counts) cannot establish identity safely.
    if (!filename(original.path) || !Number.isFinite(original.size) || original.size < 0 ||
        !Number.isFinite(original.lastModified) || original.lastModified < 0) {
      unresolved.push(original.id);
      continue;
    }
    // A directory selection may contain duplicate filenames. Size and timestamp
    // must both agree, and only one candidate may match.
    const possible = candidates.filter((candidate) =>
      Boolean(filename(candidate.path)) && Number.isFinite(candidate.size) && candidate.size >= 0 &&
      Number.isFinite(candidate.lastModified) && candidate.lastModified >= 0 &&
      filename(candidate.path) === filename(original.path)
      && candidate.size === original.size
      && candidate.lastModified === original.lastModified
      && !claimed.has(suffix(candidate.path)));
    if (possible.length === 1) {
      matches.push({ id: original.id, path: possible[0].path });
      claimed.add(suffix(possible[0].path));
    } else if (possible.length === 0) unresolved.push(original.id);
    else ambiguous.push(original.id);
  }
  return { matches, unresolved, ambiguous };
}

/** Only reveal a folder as a suggestion; never silently substitute its contents. */
export function parentFolder(path: string): string {
  const clean = separators(path);
  const last = clean.lastIndexOf('/');
  return last < 0 ? '' : clean.slice(0, last) || '/';
}
