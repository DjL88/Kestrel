import { Sha256Stream } from './sha256';

/** A content fingerprint of the EXACT original bytes, computed one bounded slice at a time.
 * Browser File/Blob.slice works without secure-context crypto.subtle and avoids a second
 * full-size buffer for high-resolution RAW originals. */
export type OriginalByteSource = { size: number; slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> } };

export async function hashOriginalBytes(blob: OriginalByteSource, signal?: AbortSignal): Promise<string> {
  // Neither a directory picker nor a custom/ranged byte source is trusted to
  // honour TypeScript's declared shape. A short read must never be fingerprinted
  // as though it were the full original: the digest would look perfectly valid.
  const size = blob.size;
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Original has an invalid byte length.');
  const sha = new Sha256Stream();
  const CHUNK_BYTES = 1024 * 1024;
  for (let offset = 0; offset < size; offset += CHUNK_BYTES) {
    if (signal?.aborted) throw new Error('Original fingerprint cancelled.');
    const end = Math.min(offset + CHUNK_BYTES, size);
    const bytes = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
    if (bytes.byteLength !== end - offset) {
      throw new Error('Original ended before the expected bytes; fingerprint refused.');
    }
    sha.update(bytes);
  }
  if (signal?.aborted) throw new Error('Original fingerprint cancelled.');
  // A mutable provider that changes its reported size mid-read cannot prove
  // that the fingerprint refers to the same file metadata.
  if (blob.size !== size) throw new Error('Original byte length changed during fingerprint.');
  return sha.digest();
}

/** Missing or malformed legacy fingerprints are NOT evidence of matching content. */
export function isSameOriginalBytes(expected: unknown, candidate: string): boolean {
  return typeof expected === 'string' && /^[0-9a-f]{64}$/.test(expected) && expected === candidate;
}
