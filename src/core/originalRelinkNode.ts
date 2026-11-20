/**
 * Desktop Node-only adapter for the pure relink preflight. No source is modified.
 * The catalogue owner must repeat verification at transaction commit: this is
 * NOT an atomic filesystem+catalogue transaction or a browser/mobile adapter.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { planVerifiedRelinks, type OriginalIdentity, type RelinkResult } from './originalRelinkProof';

export interface FileRelinkCandidate {
  photoId: string;
  /** Absolute filesystem path; never derive from a display filename. */
  path: string;
}
export type FileRelinkResult = RelinkResult;

const safeId = (s: unknown): s is string =>
  typeof s === 'string' && s.length > 0 && s.trim() === s &&
  !/[\u0000-\u001f\u007f]/.test(s);

async function hashRegularFile(path: string, signal?: AbortSignal): Promise<{ byteLength: number; sha256: string; canonicalPath: string; physicalKey: string }> {
  if (signal?.aborted) throw new Error('relink-cancelled');
  const beforePath = await lstat(path);
  if (!beforePath.isFile() || beforePath.isSymbolicLink())
    throw new Error('not-regular-file');
  const canonicalPath = await realpath(path);
  // O_NOFOLLOW rejects a final-component symlink introduced after lstat.
  // Inode comparison below also rejects a path replaced between lstat and open.
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.dev !== beforePath.dev || before.ino !== beforePath.ino)
      throw new Error('file-changed-during-verification');
    const hash = createHash('sha256');
    let count = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, signal })) {
      if (signal?.aborted) throw new Error('relink-cancelled');
      hash.update(chunk);
      count += chunk.length;
      if (!Number.isSafeInteger(count)) throw new Error('unsafe-file-length');
    }
    const after = await handle.stat();
    const afterPath = await lstat(path);
    if (!afterPath.isFile() || afterPath.isSymbolicLink() ||
        before.dev !== after.dev || before.ino !== after.ino ||
        before.size !== after.size || count !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
        after.dev !== afterPath.dev || after.ino !== afterPath.ino ||
        after.size !== afterPath.size || after.mtimeMs !== afterPath.mtimeMs ||
        after.ctimeMs !== afterPath.ctimeMs ||
        canonicalPath !== await realpath(path))
      throw new Error('file-changed-during-verification');
    return {
      byteLength: count, sha256: hash.digest('hex'), canonicalPath,
      // Distinct hard-link paths may name the same physical original.
      physicalKey: `${after.dev}:${after.ino}`,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Stream one file at a time; no full-file buffers or parallel 500-RAW memory spike.
 * Missing, duplicate or unreadable candidates fail the entire plan.
 */
export async function verifyDesktopRelinkFiles(
  originals: readonly OriginalIdentity[],
  files: readonly FileRelinkCandidate[],
  signal?: AbortSignal,
): Promise<FileRelinkResult> {
  const failures: Array<{ photoId: string; reason: string }> = [];
  const candidates: Array<{ photoId: string; candidateKey: string; byteLength: number; sha256: string }> = [];
  const seenPaths = new Set<string>();
  const seenPhysicalFiles = new Set<string>();
  for (const file of files) {
    if (signal?.aborted) {
      failures.push({ photoId: file.photoId, reason: 'relink-cancelled' });
      break;
    }
    if (!safeId(file.photoId) || typeof file.path !== 'string' ||
        !file.path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(file.path)) {
      failures.push({ photoId: String(file.photoId), reason: 'invalid-file-candidate' });
      continue;
    }
    try {
      const verified = await hashRegularFile(file.path, signal);
      if (seenPaths.has(verified.canonicalPath) || seenPhysicalFiles.has(verified.physicalKey))
        failures.push({ photoId: file.photoId, reason: 'duplicate-candidate-path' });
      seenPaths.add(verified.canonicalPath);
      seenPhysicalFiles.add(verified.physicalKey);
      candidates.push({
        photoId: file.photoId, candidateKey: verified.canonicalPath,
        byteLength: verified.byteLength, sha256: verified.sha256,
      });
    } catch {
      failures.push({ photoId: file.photoId, reason: signal?.aborted ? 'relink-cancelled' : 'candidate-unreadable-or-changed' });
    }
  }
  const plan = planVerifiedRelinks(originals, candidates);
  if (!failures.length) return plan;
  return {
    ok: false,
    failures: [...failures, ...(!plan.ok ? plan.failures : [])],
  };
}
