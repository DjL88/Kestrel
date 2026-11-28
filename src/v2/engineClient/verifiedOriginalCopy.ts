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

/** A read bound to the current original registration, rather than a cached preview or held Blob. */
export interface CurrentOriginalReader {
  read(): Promise<Blob | undefined>;
  isCurrent(): boolean;
}

/** Read the currently connected original and require its imported fingerprint.
 * Keep the registration guard alive through any asynchronous decode/render before delivery.
 */
export async function readVerifiedExportOriginal(
  reader: CurrentOriginalReader,
  expectedSha256: unknown,
  filename: string,
  signal?: AbortSignal,
): Promise<{ bytes: Blob; assertCurrent(): void }> {
  const assertCurrent = () => {
    signal?.throwIfAborted();
    if (!reader.isCurrent()) throw new Error(`The original for ${filename} changed during export. Retry the export.`);
  };
  assertCurrent();
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256))
    throw new Error(`Import ${filename} again to verify its original fingerprint before exporting.`);
  const bytes = await reader.read();
  assertCurrent();
  if (!bytes) throw new Error(`Reconnect ${filename} before exporting its original.`);
  const verified = await verifyExactOriginalCopy(bytes, expectedSha256, signal);
  assertCurrent();
  return { bytes: verified, assertCurrent };
}
