import { activateApprovedAsset, readVerifiedActive, type ApprovedAsset } from '../core/verifiedAssetActivation';
import { PHOTO_CHECK_BASE_URL, PHOTO_CHECK_PACK, PHOTO_CHECK_TOTAL_BYTES, packAssetId, type PackFile } from '../core/photoCheckPack';
import { indexedDbAssetSlots } from './verifiedAssetIndexedDb';
import { openSmolVlm, type SmolVlmFiles } from './smolvlmRuntime';
import {
  parseTokenizerOrThrow, deviceRamBytesForInstall, deviceLikelyTooSmall, OBSERVED_PEAK_RAM_BYTES,
} from './photoCheckSmokeTest';

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

/** A real structural check per file, run before it is marked active (#703 / #418 W5, 22 Nov 2026).
 * Previously this was a no-op: a byte-correct but structurally broken file only failed much later,
 * deep inside a real photo check. The tokenizer check is pure and instant; the three ONNX files each
 * get a real `InferenceSession.create` + immediate release, the same loading code `openSmolVlm` uses -
 * this is not a second, separate "looks fine" heuristic. */
async function smokeTestFor(key: PackFile['key'], bytes: Uint8Array): Promise<void> {
  if (key === 'tokenizer') { parseTokenizerOrThrow(bytes); return; }
  const ort = await import('onnxruntime-web/wasm');
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  await session.release();
}

/** One real end-to-end inference, after every file has individually passed its own smoke test, so a
 * combination of individually-valid files that still fails to run together (mismatched shapes, an
 * incompatible tokenizer/decoder pairing) is caught at install time too, not on the photographer's
 * first real photo. Uses a flat neutral-grey synthetic image, never a real photo, and asks for one
 * generated token only, to keep this cheap. */
async function endToEndSmokeTest(files: SmolVlmFiles): Promise<void> {
  const ort = await import('onnxruntime-web/wasm');
  const vlm = await openSmolVlm(ort, files);
  try {
    const { IMAGE_EDGE } = await import('../core/smolvlm');
    const grey = new Uint8ClampedArray(IMAGE_EDGE * IMAGE_EDGE * 4).fill(128);
    await vlm.describe(grey, { maxTokens: 1 });
  } finally {
    await vlm.dispose();
  }
}

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
  const nav = typeof navigator === 'undefined' ? undefined : navigator as { deviceMemory?: number };
  if (deviceLikelyTooSmall(nav)) {
    throw new Error('This device does not report enough memory to run the photo check model reliably.');
  }
  const maxDeviceRamBytes = deviceRamBytesForInstall(nav);
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
      maxRamBytes: OBSERVED_PEAK_RAM_BYTES,
    };
    await activateApprovedAsset({
      asset, bytes, slots: store, signal: options.signal, currentAppVersion: APP_VERSION,
      budgetBytes: file.bytes * 2, maxDeviceRamBytes,
      smokeTest: (fileBytes) => smokeTestFor(file.key, fileBytes),
    });
  }
  // Every file individually loads; now prove the whole pipeline actually runs together before the
  // install is reported as done. A failure here must NOT leave `photoCheckInstalled()` reporting true.
  const files = await readPhotoCheckFiles();
  if (!files) throw new Error('The photo check files could not be re-read after installing.');
  await endToEndSmokeTest(files);
  verification = Promise.resolve(true);
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
