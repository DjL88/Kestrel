/**
 * Safe delivery of models and data files from the control plane's signed
 * manifest. Pure decisions only: callers do the fetching and file writes.
 *
 * Order, always: verify the manifest signature against a pinned key, parse it
 * (dataUpdateManifest.ts rejects traversal and absolute paths), download into a
 * staging slot, check bytes and SHA-256, and only then swap. A mismatch leaves
 * the previous working file in place.
 */
import { parseDataManifest, type DataAsset, type DataManifest } from './dataUpdateManifest';
import { openEnvelope, sha256Hex, type PinnedKeys } from './signedEnvelope';

export type ManifestCheck =
  | { ok: true; manifest: DataManifest }
  | { ok: false; reason: 'malformed' | 'unknown_key' | 'bad_signature' | 'invalid_manifest' };

export async function openSignedDataManifest(envelope: unknown, keys: PinnedKeys): Promise<ManifestCheck> {
  const opened = await openEnvelope(envelope, keys);
  if ('failure' in opened) return { ok: false, reason: opened.failure };
  const manifest = parseDataManifest(opened.payload);
  return manifest ? { ok: true, manifest } : { ok: false, reason: 'invalid_manifest' };
}

/** What is installed for one asset id. */
export interface InstalledAsset { id: string; version: string; sha256: string }

export type StageDecision =
  | { action: 'swap'; installed: InstalledAsset }
  | { action: 'keep_previous'; installed: InstalledAsset | null; reason: 'size_mismatch' | 'checksum_mismatch' };

/**
 * Decide whether downloaded bytes may replace what is installed. Never
 * returns 'swap' unless the bytes match the signed manifest exactly.
 */
export async function stageDownloadedAsset(
  asset: DataAsset, bytes: Uint8Array<ArrayBuffer>, previous: InstalledAsset | null,
): Promise<StageDecision> {
  if (bytes.byteLength !== asset.bytes) return { action: 'keep_previous', installed: previous, reason: 'size_mismatch' };
  if (await sha256Hex(bytes) !== asset.sha256) return { action: 'keep_previous', installed: previous, reason: 'checksum_mismatch' };
  return { action: 'swap', installed: { id: asset.id, version: asset.version, sha256: asset.sha256 } };
}

/** Plain words for a readiness badge. Unknown stays unknown. */
export function assetReadiness(installed: InstalledAsset | null, lastFailure: StageDecision | null): string {
  if (lastFailure?.action === 'keep_previous') {
    return installed
      ? `Update rejected (${lastFailure.reason.replace('_', ' ')}); still using ${installed.version}.`
      : `Download rejected (${lastFailure.reason.replace('_', ' ')}); not installed.`;
  }
  return installed ? `Ready: ${installed.version}` : 'Not installed';
}
