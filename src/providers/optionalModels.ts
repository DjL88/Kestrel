import { Sha256Stream } from '../core/sha256';
import { optionalModelBytes, optionalModelConfigured, type OptionalModel, type OptionalModelFile } from '../core/optionalModels';
import { getModel, hasModel, putModel, removeModel } from './modelStore';

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

export interface PackDeps { store: PackStore; fetch: typeof fetch }
const defaults = (): PackDeps => ({ store: deviceStore, fetch: (...args) => fetch(...args) });

const keyOf = (file: OptionalModelFile) => `${file.url}#${file.sha256}`;

export async function optionalModelStatus(model: OptionalModel, deps: PackDeps = defaults()): Promise<OptionalModelStatus> {
  if (!optionalModelConfigured(model)) return 'unavailable';
  try {
    const present = await Promise.all(Object.values(model.files).map((file) => deps.store.has(model.cache, keyOf(file))));
    return present.every(Boolean) ? 'ready' : 'not-downloaded';
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
  if (!optionalModelConfigured(model)) throw new Error(`${model.name} is not offered in this copy of InFlight.`);
  const total = optionalModelBytes(model);
  let done = 0;
  for (const file of Object.values(model.files)) {
    signal?.throwIfAborted();
    if (await deps.store.has(model.cache, keyOf(file))) { done += file.bytes; onProgress(done / total); continue; }
    const response = await deps.fetch(file.url, { signal });
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
      await deps.store.put(model.cache, keyOf(file), new Blob(pieces as BlobPart[], { type: 'application/octet-stream' }));
    } catch {
      throw new Error(`There is not enough room on this device to keep ${model.name} (about ${Math.ceil(total / 1e6)} MB).`);
    }
    done += file.bytes;
  }
  onProgress(1);
}

export async function removeOptionalModel(model: OptionalModel, deps: PackDeps = defaults()): Promise<void> {
  for (const file of Object.values(model.files)) await deps.store.remove(model.cache, keyOf(file));
}

/** The checked bytes of one file of a downloaded pack. Throws when it is missing or does not match, never returns a bad file. */
export async function readOptionalModelFile(model: OptionalModel, name: string, deps: PackDeps = defaults()): Promise<Uint8Array> {
  const file = model.files[name];
  if (!file || !optionalModelConfigured(model)) throw new Error(`${model.name} is not offered in this copy of InFlight.`);
  const blob = await deps.store.get(model.cache, keyOf(file));
  if (!blob) throw new Error(`${model.name} has not been downloaded.`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const check = digest([bytes]);
  if (check.bytes !== file.bytes || check.sha256 !== file.sha256) {
    await deps.store.remove(model.cache, keyOf(file)).catch(() => undefined);
    throw new Error(`The stored ${model.name} failed its integrity check and was removed. Download it again to use it.`);
  }
  return bytes;
}
