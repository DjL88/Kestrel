import { hashOriginalBytes, isSameOriginalBytes } from '../../core/originalFileIdentity';

/**
 * An "Original" export is a byte-for-byte copy, NOT a re-rendered preview.
 * A matching name, EXIF, file size or path cannot establish that the connected
 * blob is the same file the photographer imported.
 *
 * Fail closed for older projects without a saved digest and for a changed,
 * truncated or disconnected original. Never substitute a cached JPEG.
 */
export async function verifyExactOriginalCopy(
  bytes: Blob,
  expectedSha256: unknown,
  signal?: AbortSignal,
): Promise<Blob> {
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error('This photo has no verified original fingerprint. Reconnect and verify the original before exporting it.');
  }
  if (bytes.size === 0) throw new Error('The connected original is empty. No original file was exported.');
  const actual = await hashOriginalBytes(bytes, signal);
  if (!isSameOriginalBytes(expectedSha256, actual)) {
    throw new Error('The connected original differs from the imported photo. Export refused to protect your originals.');
  }
  return bytes;
}
