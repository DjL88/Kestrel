import { Sha256Stream } from './sha256';

/** A content fingerprint of the EXACT original bytes, computed one bounded slice at a time.
 * Browser File/Blob.slice works without secure-context crypto.subtle and avoids a second
 * full-size buffer for high-resolution RAW originals. */
export type OriginalByteSource = { size: number; slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> } };

export async function hashOriginalBytes(blob: OriginalByteSource, signal?: AbortSignal): Promise<string> {
  const sha = new Sha256Stream();
  const CHUNK_BYTES = 1024 * 1024;
  for (let offset = 0; offset < blob.size || (offset === 0 && blob.size === 0); offset += CHUNK_BYTES) {
    if (signal?.aborted) throw new Error('Original fingerprint cancelled.');
    const bytes = new Uint8Array(await blob.slice(offset, Math.min(offset + CHUNK_BYTES, blob.size)).arrayBuffer());
    sha.update(bytes);
    if (blob.size === 0) break;
  }
  if (signal?.aborted) throw new Error('Original fingerprint cancelled.');
  return sha.digest();
}

/** Missing or malformed legacy fingerprints are NOT evidence of matching content. */
export function isSameOriginalBytes(expected: unknown, candidate: string): boolean {
  return typeof expected === 'string' && /^[0-9a-f]{64}$/.test(expected) && expected === candidate;
}
