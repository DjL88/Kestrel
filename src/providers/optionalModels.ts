import { ownerSwitchOffForModel } from '../core/featureSwitches';
import { Sha256Stream } from '../core/sha256';
import { BUNDLED_PACK_IDS, optionalModelBytes, optionalModelConfigured, type OptionalModel, type OptionalModelFile } from '../core/optionalModels';
import { getModel, hasModel, putModel, removeModel } from './modelStore';
import { modelSource } from './modelUpdater';
import { packUrlResolver, type PackUrlResolver } from './packManifest';

/**
 * Download, keep and read an optional model pack (src/core/optionalModels.ts). Nothing here runs unless the photographer
 * asks: there is no background fetch. Every file is checked against its pinned length and SHA-256 as it arrives and
 * again when it is read back, so a damaged or swapped copy is never executed; the caller then uses the fallback model.
 */
export type OptionalModelStatus = 'unavailable' | 'not-downloaded' | 'ready';

export interface PackStore {
  get(cache: string, key: string): Promise<Blob | undefined>;
  has(cache: string, key: string): Promise<boolean>;
  put(cache: string, key: string, blob: Blob): Promise<void>;
  remove(cache: string, key: string): Promise<void>;
}

const deviceStore: PackStore = { get: getModel, has: hasModel, put: putModel, remove: removeModel };

export interface PackDeps {
  store: PackStore;
  fetch: typeof fetch;
  /** Where a file comes from when it has no address of its own: the signed model manifest, read at download time. */
  resolveUrl?: PackUrlResolver;
  /** Packs this installer carries in its own files, read from `/models/<file>` and checked like a download. */
  bundled?: ReadonlySet<string>;
}
// Only a build with the models bucket and its pinned key reads addresses from the manifest; others offer no pack.
const manifestUrls = modelSource.baseUrl && Object.keys(modelSource.keys).length ? packUrlResolver({ ...modelSource, fetch: (...args) => fetch(...args) }) : undefined;
const defaults = (): PackDeps => ({ store: deviceStore, fetch: (...args) => fetch(...args), bundled: BUNDLED_PACK_IDS, ...(manifestUrls ? { resolveUrl: manifestUrls } : {}) });
/** The pack ships inside this installer: every file has a published name to be served under. */
export const isBundledPack = (model: OptionalModel, deps: Pick<PackDeps, 'bundled'> = defaults()) =>
  Boolean(deps.bundled?.has(model.id)) && Object.values(model.files).every((file) => Boolean(file.file));
// An owner switch (src/core/featureSwitches.ts) hides a pack: not offered, not downloaded, not loaded.
const offered = (model: OptionalModel, deps: PackDeps) => !ownerSwitchOffForModel(model.id) && (isBundledPack(model, deps) || optionalModelConfigured(model, deps.resolveUrl !== undefined));

/** A kept file is known by its pack, role and SHA-256, wherever it was downloaded from. */
const keyOf = (model: OptionalModel, role: string, file: OptionalModelFile) => `${model.id}/${role}#${file.sha256}`;
/** Copies kept before the manifest, under their old address; still found and still checked. */
const legacyKeyOf = (file: OptionalModelFile) => (file.url ? `${file.url}#${file.sha256}` : null);

async function findKey(store: PackStore, model: OptionalModel, role: string, file: OptionalModelFile): Promise<string | null> {
  const key = keyOf(model, role, file);
  if (await store.has(model.cache, key)) return key;
  const legacy = legacyKeyOf(file);
  return legacy && (await store.has(model.cache, legacy)) ? legacy : null;
}

export async function optionalModelStatus(model: OptionalModel, deps: PackDeps = defaults()): Promise<OptionalModelStatus> {
  if (!offered(model, deps)) return 'unavailable';
  if (isBundledPack(model, deps)) return 'ready';
  try {
    const present = await Promise.all(Object.entries(model.files).map(([role, file]) => findKey(deps.store, model, role, file)));
    return present.every((key) => key !== null) ? 'ready' : 'not-downloaded';
  } catch {
    return 'not-downloaded';
  }
}

function digest(pieces: readonly Uint8Array[]): { bytes: number; sha256: string } {
  const hash = new Sha256Stream();
  let bytes = 0;
  for (const piece of pieces) { hash.update(piece); bytes += piece.byteLength; }
  return { bytes, sha256: hash.digest() };
}

/** Fetch every missing file of the pack once, check it, keep it on this device. Progress is 0..1 over the whole pack. */
export async function downloadOptionalModel(
  model: OptionalModel,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  deps: PackDeps = defaults(),
): Promise<void> {
  if (!offered(model, deps)) throw new Error(`${model.name} is not offered in this copy of InFlight.`);
  const total = optionalModelBytes(model);
  let done = 0;
  for (const [role, file] of Object.entries(model.files)) {
    signal?.throwIfAborted();
    if (await findKey(deps.store, model, role, file)) { done += file.bytes; onProgress(done / total); continue; }
    const url = file.url || (deps.resolveUrl ? await deps.resolveUrl(model, role) : '');
    if (!url) throw new Error(`${model.name} is not offered in this copy of InFlight.`);
    const response = await deps.fetch(url, { signal });
    if (!response.ok || !response.body) throw new Error(`${model.name} could not be downloaded. Check the connection and try again.`);
    const reader = response.body.getReader();
    const pieces: Uint8Array[] = [];
    const hash = new Sha256Stream();
    let received = 0;
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      hash.update(value);
      pieces.push(value);
      received += value.byteLength;
      if (received > file.bytes) throw new Error(`${model.name} is larger than expected, so it was not kept.`);
      onProgress(Math.min(0.99, (done + received) / total));
    }
    if (received !== file.bytes || hash.digest() !== file.sha256) {
      throw new Error(`The downloaded ${model.name} does not match its checksum, so it was not kept. Try again.`);
    }
    try {
      await deps.store.put(model.cache, keyOf(model, role, file), new Blob(pieces as BlobPart[], { type: 'application/octet-stream' }));
    } catch {
      throw new Error(`There is not enough room on this device to keep ${model.name} (about ${Math.ceil(total / 1e6)} MB).`);
    }
    done += file.bytes;
  }
  onProgress(1);
}

export async function removeOptionalModel(model: OptionalModel, deps: PackDeps = defaults()): Promise<void> {
  // A pack that came with the installer is part of the app; there is no separate copy to remove.
  if (isBundledPack(model, deps)) return;
  for (const [role, file] of Object.entries(model.files)) {
    await deps.store.remove(model.cache, keyOf(model, role, file));
    const legacy = legacyKeyOf(file);
    if (legacy) await deps.store.remove(model.cache, legacy);
  }
}

/** The checked bytes of one file of a downloaded pack. Throws when it is missing or does not match, never returns a bad file. */
export async function readOptionalModelFile(model: OptionalModel, name: string, deps: PackDeps = defaults()): Promise<Uint8Array> {
  const file = model.files[name];
  if (!file || !offered(model, deps)) throw new Error(`${model.name} is not offered in this copy of InFlight.`);
  if (isBundledPack(model, deps)) {
    const response = await deps.fetch(`/models/${file.file}`);
    if (!response.ok) throw new Error(`${model.name} is missing from this copy of InFlight. Reinstall InFlight to restore it.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const check = digest([bytes]);
    if (check.bytes !== file.bytes || check.sha256 !== file.sha256) {
      throw new Error(`${model.name} in this copy of InFlight failed its integrity check, so it was not used. Reinstall InFlight to restore it.`);
    }
    return bytes;
  }
  const key = await findKey(deps.store, model, name, file);
  const blob = key ? await deps.store.get(model.cache, key) : undefined;
  if (!key || !blob) throw new Error(`${model.name} has not been downloaded.`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const check = digest([bytes]);
  if (check.bytes !== file.bytes || check.sha256 !== file.sha256) {
    await deps.store.remove(model.cache, key).catch(() => undefined);
    throw new Error(`The stored ${model.name} failed its integrity check and was removed. Download it again to use it.`);
  }
  return bytes;
}
