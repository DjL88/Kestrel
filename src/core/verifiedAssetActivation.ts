/**
 * Offline-first activation for NON-EXECUTABLE, rights-approved data packages.
 * The caller MUST verify the publisher's pinned Ed25519 signature first
 * (see trustedModelDelivery in PR #655). A remote digest alone is not trust.
 * No network, photo, credential or app-code access exists in this module.
 */
export type AssetKind = 'model' | 'lens-db' | 'knowledge' | 'labels' | 'camera-record';
export interface ApprovedAsset {
  id: string; version: string; kind: AssetKind; sha256: string; bytes: number;
  licence: string; provenance: string; approved: true;
  minAppVersion?: string; maxRamBytes?: number;
}
export interface ActiveAsset { id: string; version: string; sha256: string; slot: string }
export interface AssetSlots {
  /** Immutable write: MUST fail if a slot already exists with different bytes. */
  writeImmutable(slot: string, bytes: Uint8Array): Promise<void>;
  read(slot: string): Promise<Uint8Array | undefined>;
  /** Durable, atomic compare-and-swap. Never acknowledge before fsync/transaction commit. */
  compareAndSwapActive(id: string, expected: ActiveAsset | undefined, next: ActiveAsset): Promise<boolean>;
  active(id: string): Promise<ActiveAsset | undefined>;
}
export interface ActivationOptions {
  /** Input is a signed-and-verified, approved manifest entry; no unsigned caller input. */
  asset: ApprovedAsset;
  bytes: Uint8Array;
  slots: AssetSlots;
  /** The installed app's own trusted runtime compatibility check. */
  smokeTest: (bytes: Uint8Array, asset: ApprovedAsset) => Promise<void>;
  budgetBytes: number;
  currentAppVersion: string;
  maxDeviceRamBytes: number;
  signal?: AbortSignal;
}
const ID = /^[a-z][a-z0-9._-]{0,127}$/;
const HEX = /^[a-f0-9]{64}$/;
const VER = /^\d+\.\d+\.\d+$/;
const inFlight = new Set<string>();
const digest = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
const versionParts = (v: string) => v.split('.').map(Number);
const newerOrEqual = (a: string, b: string) => {
  const x = versionParts(a), y = versionParts(b);
  return x[0] > y[0] || (x[0] === y[0] && (x[1] > y[1] || (x[1] === y[1] && x[2] >= y[2])));
};
function assertReady(asset: ApprovedAsset, options: ActivationOptions): void {
  if (!asset.approved || !ID.test(asset.id) || !ID.test(asset.kind) || !VER.test(asset.version) ||
      !HEX.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 ||
      asset.bytes > 2_147_483_648 || asset.bytes !== options.bytes.byteLength ||
      !asset.licence.trim() || !asset.provenance.trim() ||
      !VER.test(options.currentAppVersion) ||
      (asset.minAppVersion !== undefined && (!VER.test(asset.minAppVersion) ||
        !newerOrEqual(options.currentAppVersion, asset.minAppVersion))) ||
      !Number.isSafeInteger(options.budgetBytes) || options.budgetBytes < asset.bytes * 2 ||
      !Number.isSafeInteger(options.maxDeviceRamBytes) || options.maxDeviceRamBytes <= 0 ||
      (asset.maxRamBytes !== undefined && (!Number.isSafeInteger(asset.maxRamBytes) ||
        asset.maxRamBytes <= 0 || asset.maxRamBytes > options.maxDeviceRamBytes))) {
    throw new Error('Asset rights, compatibility, size or two-version storage budget not approved');
  }
}
function notCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Asset update cancelled');
}
/**
 * A verified, immutable content slot is written before the pointer changes.
 * Failure leaves the old pointer untouched. A CAS conflict cannot overwrite
 * another worker's update. Orphan slots may be reclaimed only by a separate
 * verified garbage collector, never by deleting the previous known-good.
 */
export async function activateApprovedAsset(options: ActivationOptions): Promise<ActiveAsset> {
  const { asset, bytes, slots, signal } = options;
  assertReady(asset, options);
  if (inFlight.has(asset.id)) throw new Error('Asset activation already in progress');
  inFlight.add(asset.id);
  try {
    notCancelled(signal);
    if (await digest(bytes) !== asset.sha256) throw new Error('Asset digest mismatch');
    notCancelled(signal);
    const previous = await slots.active(asset.id);
    if (previous?.sha256 === asset.sha256 && previous.version === asset.version) return previous;
    // Never replace a verified newer asset with an older signed-but-replayed version.
    if (previous && (!VER.test(previous.version) || !newerOrEqual(asset.version, previous.version) ||
        (asset.version === previous.version && asset.sha256 !== previous.sha256)))
      throw new Error('Asset version rollback or same-version replacement refused');
    await options.smokeTest(bytes, asset);
    notCancelled(signal);
    const slot = `sha256-${asset.sha256}`;
    await slots.writeImmutable(slot, bytes);
    const readback = await slots.read(slot);
    if (!readback || readback.byteLength !== asset.bytes || await digest(readback) !== asset.sha256)
      throw new Error('Staged asset failed readback verification');
    notCancelled(signal);
    const next: ActiveAsset = { id: asset.id, version: asset.version, sha256: asset.sha256, slot };
    if (!await slots.compareAndSwapActive(asset.id, previous, next))
      throw new Error('Asset pointer changed during activation');
    // A committed pointer is a success even if cancellation arrives after the CAS.
    return next;
  } finally { inFlight.delete(asset.id); }
}
/** Read active bytes defensively; on corruption return undefined so bundled fallback stays usable. */
export async function readVerifiedActive(slots: AssetSlots, id: string): Promise<Uint8Array | undefined> {
  if (!ID.test(id)) return undefined;
  try {
    const active = await slots.active(id);
    if (!active || !HEX.test(active.sha256) || active.slot !== `sha256-${active.sha256}`) return undefined;
    const bytes = await slots.read(active.slot);
    return bytes && await digest(bytes) === active.sha256 ? bytes : undefined;
  } catch { return undefined; }
}
