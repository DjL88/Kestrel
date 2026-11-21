/** Offline asset entry point: signature verification is mandatory before activation.
 * A caller supplies the existing pinned Ed25519 verifier (#655); this module
 * NEVER treats a bare hash, approval flag, or network response as authority.
 */
import {
  activateApprovedAsset, readVerifiedActive,
  type ApprovedAsset, type ActiveAsset, type AssetSlots,
} from './verifiedAssetActivation';

export interface VerifiedManifestAuthority<Envelope> {
  /** Must reject unknown keys, invalid signatures, expiry, rollback and wrong app/origin. */
  verify(envelope: Envelope): Promise<readonly ApprovedAsset[]>;
}
export interface OfflineAssetStore extends AssetSlots {
  /** Previous pointer retained transactionally with active; never silently promotes it. */
  previous(id: string): Promise<ActiveAsset | undefined>;
}
export interface OfflineAssetRuntime<Envelope> {
  install(envelope: Envelope, id: string, bytes: Uint8Array, options: {
    currentAppVersion: string; maxDeviceRamBytes: number; budgetBytes: number;
    smokeTest: (bytes: Uint8Array, asset: ApprovedAsset) => Promise<void>;
    signal?: AbortSignal;
  }): Promise<ActiveAsset>;
  /** Returns a verified active version, then previous known-good, then bundled.
   * The bundled fallback is a trusted app-shipped asset, not a network download. */
  open(id: string, bundled: () => Promise<Uint8Array | undefined>): Promise<{
    bytes: Uint8Array | undefined; source: 'active' | 'previous' | 'bundled' | 'unavailable';
  }>;
}
const validId = (id: string) => /^[a-z][a-z0-9._-]{0,127}$/.test(id);
const sha = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    x => x.toString(16).padStart(2, '0')).join('');
async function readPointer(slots: AssetSlots, pointer: ActiveAsset | undefined) {
  if (!pointer || pointer.slot !== 'sha256-' + pointer.sha256 ||
      !/^[a-f0-9]{64}$/.test(pointer.sha256)) return undefined;
  try {
    const bytes = await slots.read(pointer.slot);
    return bytes && await sha(bytes) === pointer.sha256 ? bytes : undefined;
  } catch { return undefined; }
}
export function createOfflineAssetRuntime<Envelope>(
  authority: VerifiedManifestAuthority<Envelope>, slots: OfflineAssetStore,
): OfflineAssetRuntime<Envelope> {
  return {
    async install(envelope, id, bytes, options) {
      if (!validId(id)) throw new Error('Invalid asset identifier');
      // No storage writes or model execution before signature/sequence verification.
      const entries = await authority.verify(envelope);
      const matches = entries.filter(a => a.id === id);
      if (matches.length !== 1 || matches[0].approved !== true)
        throw new Error('Signed manifest has no uniquely approved asset');
      return activateApprovedAsset({ ...options, asset: matches[0], bytes, slots });
    },
    async open(id, bundled) {
      if (!validId(id)) return { bytes: undefined, source: 'unavailable' };
      const active = await readVerifiedActive(slots, id);
      if (active) return { bytes: active, source: 'active' };
      const previous = await slots.previous(id).catch(() => undefined);
      if (previous?.id === id) {
        const bytes = await readPointer(slots, previous);
        if (bytes) return { bytes, source: 'previous' };
      }
      // Fail closed if the bundle cannot be read. No implicit network request.
      try {
        const bytes = await bundled();
        if (bytes) return { bytes, source: 'bundled' };
      } catch { /* Missing bundled fallback is an explicit unavailable result. */ }
      return { bytes: undefined, source: 'unavailable' };
    },
  };
}
