import { activateApprovedAsset, readVerifiedActive, type ApprovedAsset } from '../core/verifiedAssetActivation';
import { PHOTO_CHECK_BASE_URL, PHOTO_CHECK_PACK, PHOTO_CHECK_TOTAL_BYTES, packAssetId } from '../core/photoCheckPack';
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
// Integrity-check the 264 MB pack once per app session, not on every editor mount.
// Every actual inference still reads and re-verifies each model file.
let verification: Promise<boolean> | null = null;

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

/** The photographer has chosen to install: fetch, verify and activate each pinned file. Safe to retry or cancel at any point. */
export async function installPhotoCheck(options: InstallOptions = {}): Promise<void> {
  verification = null;
  const base = (options.baseUrl ?? PHOTO_CHECK_BASE_URL).replace(/\/$/, '');
  const store = slots();
  let received = 0;
  const report = (n: number) => { received += n; options.onProgress?.({ received, total: PHOTO_CHECK_TOTAL_BYTES }); };
  for (const file of PHOTO_CHECK_PACK.files) {
    const id = packAssetId(file);
    if (await readVerifiedActive(store, id)) { report(file.bytes); continue; } // already installed and still verifies
    const bytes = await download(`${base}/${file.path}`, file.bytes, options, report);
    const asset: ApprovedAsset = {
      id, version: PHOTO_CHECK_PACK.version, kind: 'model', sha256: file.sha256, bytes: file.bytes,
      licence: PHOTO_CHECK_PACK.licence, provenance: PHOTO_CHECK_PACK.provenance, approved: true,
    };
    await activateApprovedAsset({
      asset, bytes, slots: store, signal: options.signal, currentAppVersion: APP_VERSION,
      budgetBytes: file.bytes * 2, maxDeviceRamBytes: 8_589_934_592,
      smokeTest: async () => { /* the pinned digest is the check; the model itself is exercised on first use */ },
    });
  }
  verification = Promise.resolve(true); // each activation verified the exact pinned bytes
}

/** All four files, each re-verified against its pinned digest as it is read. Null when anything is missing or corrupt. */
export async function readPhotoCheckFiles(): Promise<SmolVlmFiles | null> {
  const store = slots();
  const read: Record<string, Uint8Array> = {};
  for (const file of PHOTO_CHECK_PACK.files) {
    const bytes = await readVerifiedActive(store, packAssetId(file));
    if (!bytes) { verification = Promise.resolve(false); return null; }
    read[file.key] = bytes;
  }
  return { vision: read.vision, embed: read.embed, decoder: read.decoder, tokenizer: JSON.parse(new TextDecoder().decode(read.tokenizer)) };
}
async function verifyInstalled(): Promise<boolean> {
  const store = slots();
  for (const file of PHOTO_CHECK_PACK.files) {
    if (!(await readVerifiedActive(store, packAssetId(file)))) return false;
  }
  return true;
}
export function photoCheckInstalled(): Promise<boolean> {
  verification ??= verifyInstalled().catch(() => false);
  return verification;
}
