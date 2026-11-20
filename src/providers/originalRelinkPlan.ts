/**
 * Offline, read-only original relink planning. A filename, byte count and
 * timestamp are hints, NOT proof of content identity. Never resolve a batch
 * collision by array order or silently link one physical file twice.
 */
export interface SavedOriginal {
  id: string;
  path: string;
  size: number;
  lastModified: number;
  /** SHA-256 of the entire original file, when independently measured. */
  sha256?: string;
}
export interface CandidateOriginal {
  path: string;
  size: number;
  lastModified: number;
  /** SHA-256 of the entire candidate file, when independently measured. */
  sha256?: string;
}
export interface RelinkMatch { id: string; path: string }
export interface RelinkPlan {
  matches: RelinkMatch[];
  unresolved: string[];
  ambiguous: string[];
}

const separators = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');
const filename = (path: string) => separators(path).split('/').at(-1)?.toLowerCase() ?? '';
const normalizedPath = (path: string) => separators(path).toLowerCase();
const valid = (file: { path: string; size: number; lastModified: number }) =>
  Boolean(filename(file.path)) &&
  Number.isSafeInteger(file.size) && file.size >= 0 &&
  Number.isFinite(file.lastModified) && file.lastModified >= 0;
const digest = (value: string | undefined) => value?.toLowerCase();
const validDigest = (value: string | undefined) => value === undefined || /^[0-9a-f]{64}$/i.test(value);
const hashedSignature = (file: { size: number; sha256?: string }) =>
  JSON.stringify([file.size, digest(file.sha256)]);
const signature = (file: { path: string; size: number; lastModified: number }) =>
  JSON.stringify([filename(file.path), file.size, file.lastModified]);

/**
 * A one-to-one batch plan. Any repeated catalogue ID, original signature,
 * candidate signature or candidate path makes the affected records ambiguous.
 * This is deliberately conservative: metadata alone cannot disambiguate two
 * cameras producing the same filename/size/time, or two identical NAS copies.
 * Caller must confirm metadata-only matches before applying links. When a saved
 * SHA-256 is supplied, only a candidate with the same full-file digest and
 * byte size is eligible; this planner does not calculate or attest digests.
 */
export function planOriginalRelink(
  originals: readonly SavedOriginal[],
  candidates: readonly CandidateOriginal[],
): RelinkPlan {
  const matches: RelinkMatch[] = [];
  const unresolved: string[] = [];
  const ambiguous: string[] = [];
  const idCount = new Map<string, number>();
  const originalCount = new Map<string, number>();
  const candidateCount = new Map<string, number>();
  const candidatePaths = new Map<string, number>();
  const hashedOriginalCount = new Map<string, number>();
  const hashedCandidateCount = new Map<string, number>();
  const hashedCandidateBySignature = new Map<string, CandidateOriginal>();

  for (const original of originals) {
    idCount.set(original.id, (idCount.get(original.id) ?? 0) + 1);
    if (valid(original) && validDigest(original.sha256) && original.sha256) {
      const key = hashedSignature(original);
      hashedOriginalCount.set(key, (hashedOriginalCount.get(key) ?? 0) + 1);
    }
    if (valid(original)) {
      const key = signature(original);
      originalCount.set(key, (originalCount.get(key) ?? 0) + 1);
    }
  }
  for (const candidate of candidates) {
    if (!valid(candidate) || !validDigest(candidate.sha256)) continue;
    if (candidate.sha256) {
      const hashKey = hashedSignature(candidate);
      hashedCandidateCount.set(hashKey, (hashedCandidateCount.get(hashKey) ?? 0) + 1);
      hashedCandidateBySignature.set(hashKey, candidate);
    }
    const key = signature(candidate);
    const path = normalizedPath(candidate.path);
    candidateCount.set(key, (candidateCount.get(key) ?? 0) + 1);
    candidatePaths.set(path, (candidatePaths.get(path) ?? 0) + 1);
  }
  const candidateBySignature = new Map<string, CandidateOriginal>();
  for (const candidate of candidates) {
    if (valid(candidate) && validDigest(candidate.sha256)) candidateBySignature.set(signature(candidate), candidate);
  }
  for (const original of originals) {
    if (!original.id.trim() || (idCount.get(original.id) ?? 0) > 1) {
      ambiguous.push(original.id);
      continue;
    }
    if (!valid(original) || !validDigest(original.sha256)) {
      unresolved.push(original.id);
      continue;
    }
    // When a trusted catalogue digest exists, metadata alone is NEVER enough.
    // Hash + byte size permits a renamed or re-timestamped original to reconnect.
    if (original.sha256) {
      const hashKey = hashedSignature(original);
      const count = hashedCandidateCount.get(hashKey) ?? 0;
      if (count === 0) { unresolved.push(original.id); continue; }
      if (count !== 1 || hashedOriginalCount.get(hashKey) !== 1) {
        ambiguous.push(original.id); continue;
      }
      const candidate = hashedCandidateBySignature.get(hashKey)!;
      if ((candidatePaths.get(normalizedPath(candidate.path)) ?? 0) !== 1) {
        ambiguous.push(original.id); continue;
      }
      matches.push({ id: original.id, path: candidate.path });
      continue;
    }
    const key = signature(original);
    const count = candidateCount.get(key) ?? 0;
    if (count === 0 && originalCount.get(key) === 1) {
      unresolved.push(original.id);
      continue;
    }
    if (count !== 1 || originalCount.get(key) !== 1) {
      ambiguous.push(original.id);
      continue;
    }
    const candidate = candidateBySignature.get(key)!;
    if ((candidatePaths.get(normalizedPath(candidate.path)) ?? 0) !== 1) {
      ambiguous.push(original.id);
      continue;
    }
    matches.push({ id: original.id, path: candidate.path });
  }
  return { matches, unresolved, ambiguous };
}

/** Only reveal a folder as a suggestion; never silently substitute its contents. */
export function parentFolder(path: string): string {
  const clean = separators(path);
  const last = clean.lastIndexOf('/');
  return last < 0 ? '' : clean.slice(0, last) || '/';
}
