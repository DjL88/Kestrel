/**
 * A fail-closed relink preflight. The caller MUST hash the complete original bytes
 * and complete candidate bytes with SHA-256 (not a preview, name or partial read).
 * No catalogue or filesystem mutation occurs here; apply the returned plan in one
 * durable catalogue transaction only after every candidate has passed.
 */
export interface OriginalIdentity {
  photoId: string;
  byteLength: number;
  sha256: string;
}
export interface RelinkCandidate {
  photoId: string;
  candidateKey: string;
  byteLength: number;
  sha256: string;
}
export interface RelinkMatch {
  photoId: string;
  candidateKey: string;
}
export type RelinkResult =
  | { ok: true; matches: RelinkMatch[] }
  | { ok: false; failures: Array<{ photoId: string; reason: string }> };

const digestPattern = /^[a-f0-9]{64}$/;
const safeId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.trim() === value &&
  !/[\u0000-\u001f\u007f]/.test(value);

const validIdentity = (value: OriginalIdentity): boolean =>
  safeId(value.photoId) &&
  Number.isSafeInteger(value.byteLength) && value.byteLength >= 0 &&
  typeof value.sha256 === 'string' && digestPattern.test(value.sha256);

const validCandidate = (value: RelinkCandidate): boolean =>
  safeId(value.photoId) && safeId(value.candidateKey) &&
  Number.isSafeInteger(value.byteLength) && value.byteLength >= 0 &&
  typeof value.sha256 === 'string' && digestPattern.test(value.sha256);

/**
 * Candidate keys must be canonical identifiers supplied by the storage adapter,
 * not display names. Reject duplicate keys and incomplete batches; never silently
 * pick the first file with the same basename or size.
 */
export function planVerifiedRelinks(
  originals: readonly OriginalIdentity[],
  candidates: readonly RelinkCandidate[],
): RelinkResult {
  const failures: Array<{ photoId: string; reason: string }> = [];
  const originalById = new Map<string, OriginalIdentity>();
  const candidateById = new Map<string, RelinkCandidate>();
  const usedKeys = new Set<string>();

  for (const original of originals) {
    if (!validIdentity(original)) {
      failures.push({ photoId: String(original.photoId), reason: 'invalid-original-evidence' });
    } else if (originalById.has(original.photoId)) {
      failures.push({ photoId: original.photoId, reason: 'duplicate-photo-id' });
    } else {
      originalById.set(original.photoId, original);
    }
  }

  for (const candidate of candidates) {
    if (!validCandidate(candidate)) {
      failures.push({ photoId: String(candidate.photoId), reason: 'invalid-candidate-evidence' });
      continue;
    }
    if (candidateById.has(candidate.photoId)) {
      failures.push({ photoId: candidate.photoId, reason: 'duplicate-photo-id' });
    } else {
      candidateById.set(candidate.photoId, candidate);
    }
    if (usedKeys.has(candidate.candidateKey)) {
      failures.push({ photoId: candidate.photoId, reason: 'duplicate-candidate-key' });
    } else {
      usedKeys.add(candidate.candidateKey);
    }
    if (!originalById.has(candidate.photoId)) {
      failures.push({ photoId: candidate.photoId, reason: 'unrecognised-photo-id' });
    }
  }

  const matches: RelinkMatch[] = [];
  for (const original of originals) {
    if (!validIdentity(original)) continue;
    const candidate = candidateById.get(original.photoId);
    if (!candidate) {
      failures.push({ photoId: original.photoId, reason: 'missing-candidate' });
    } else if (candidate.byteLength !== original.byteLength ||
               candidate.sha256 !== original.sha256) {
      failures.push({ photoId: original.photoId, reason: 'original-content-mismatch' });
    } else {
      matches.push({ photoId: original.photoId, candidateKey: candidate.candidateKey });
    }
  }

  return failures.length ? { ok: false, failures } : { ok: true, matches };
}
