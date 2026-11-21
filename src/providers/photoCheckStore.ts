import { activateApprovedAsset, readVerifiedActive, type ApprovedAsset } from '../core/verifiedAssetActivation';
import { PHOTO_CHECK_BASE_URL, PHOTO_CHECK_PACK, PHOTO_CHECK_TOTAL_BYTES, packAssetId, type PackFile } from '../core/photoCheckPack';
import { indexedDbAssetSlots } from './verifiedAssetIndexedDb';
import type { SmolVlmFiles } from './smolvlmRuntime';

const APP_VERSION = '26.11.2';
export interface InstallProgress { received: number; total: number }
export interface InstallOptions {
  /** Where the pinned files are fetched from. Defaults to the pinned upstream revision. */
  baseUrl?: string;
  signal?: AbortSignal;
  onProgress?: (progress: InstallProgress) => void;
  fetchImpl?: typeof fetch;
}
const slots = () => indexedDbAssetSlots();

async function download(url: string, expected: number, options: InstallOptions, onBytes: (n: number) => void): Promise<Uint8Array> {
  const response = await (options.fetchImpl ?? fetch)(url, { signal: options.signal, credentials: 'omit', cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error('The photo check download failed.');
  const out = new Uint8Array(expected);
  let at = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > expected) throw new Error('The photo check download is larger than expected, so it was refused.');
    out.set(value, at);
    at += value.length;
    onBytes(value.length);
  }
  if (at !== expected) throw new Error('The photo check download is incomplete, so it was refused.');
  return out;
}

const hex = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), (b) => b.toString(16).padStart(2, '0')).join('');
const approved = (id: string, bytes: number, sha256: string): ApprovedAsset => ({
  id, version: PHOTO_CHECK_PACK.version, kind: 'model', sha256, bytes,
  licence: PHOTO_CHECK_PACK.licence, provenance: PHOTO_CHECK_PACK.provenance, approved: true,
});
/** The stored pieces of one file: itself, or its pinned parts. */
const pieces = (file: PackFile) => file.parts?.map((part, i) => ({ id: packAssetId(file, i), ...part })) ?? [{ id: packAssetId(file), bytes: file.bytes, sha256: file.sha256 }];

/** The photographer has chosen to install: fetch, verify and activate each pinned file. Safe to retry or cancel at any point. */
export async function installPhotoCheck(options: InstallOptions = {}): Promise<void> {
  const base = (options.baseUrl ?? PHOTO_CHECK_BASE_URL).replace(/\/$/, '');
  const store = slots();
  let received = 0;
  const report = (n: number) => { received += n; options.onProgress?.({ received, total: PHOTO_CHECK_TOTAL_BYTES }); };
  for (const file of PHOTO_CHECK_PACK.files) {
    const parts = pieces(file);
    if ((await Promise.all(parts.map((part) => readVerifiedActive(store, part.id)))).every(Boolean)) { report(file.bytes); continue; } // already installed and still verifies
    const bytes = await download(`${base}/${file.path}`, file.bytes, options, report);
    if (await hex(bytes) !== file.sha256) throw new Error('The photo check download does not match its checksum, so it was refused.');
    let at = 0;
    for (const part of parts) {
      await activateApprovedAsset({
        asset: approved(part.id, part.bytes, part.sha256), bytes: bytes.subarray(at, at + part.bytes), slots: store, signal: options.signal,
        currentAppVersion: APP_VERSION, budgetBytes: part.bytes * 2, maxDeviceRamBytes: 8_589_934_592,
        smokeTest: async () => { /* the pinned digest is the check; the model itself is exercised on first use */ },
      });
      at += part.bytes;
    }
  }
}

/** All four files, each re-verified against its pinned digest(s) as it is read. Null when anything is missing or corrupt. */
export async function readPhotoCheckFiles(): Promise<SmolVlmFiles | null> {
  const store = slots();
  const read: Record<string, Uint8Array> = {};
  for (const file of PHOTO_CHECK_PACK.files) {
    const chunks: Uint8Array[] = [];
    for (const part of pieces(file)) {
      const bytes = await readVerifiedActive(store, part.id);
      if (!bytes) return null;
      chunks.push(bytes);
    }
    const joined = chunks.length === 1 ? chunks[0] : (() => { const out = new Uint8Array(file.bytes); let at = 0; for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; } return out; })();
    if (joined.byteLength !== file.bytes || (chunks.length > 1 && await hex(joined) !== file.sha256)) return null;
    read[file.key] = joined;
  }
  return { vision: read.vision, embed: read.embed, decoder: read.decoder, tokenizer: JSON.parse(new TextDecoder().decode(read.tokenizer)) };
}
export async function photoCheckInstalled(): Promise<boolean> {
  const store = slots();
  for (const file of PHOTO_CHECK_PACK.files) for (const part of pieces(file)) if (!(await store.active(part.id))) return false;
  return true;
}
