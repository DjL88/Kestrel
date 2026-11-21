/** Single offline-first entry point for signed non-executable asset packs.
 * The app must supply pinned public keys from its signed installer, not a server.
 * No fetch or update timer is created here; updates are an explicit caller action.
 */
import { createSignedAssetAuthority, type SignedAssetEnvelope } from './signedAssetAuthority';
import { createOfflineAssetRuntime } from './offlineAssetRuntime';
import { indexedDbAssetSlots } from '../providers/verifiedAssetIndexedDb';
import { indexedDbSequenceFence } from '../providers/verifiedAssetSequenceFence';

export interface VerifiedAssetBootstrapOptions {
  /** Keys embedded in the signed app; never accepted from downloaded metadata. */
  pinnedPublicKeys: ReadonlyMap<string, CryptoKey>;
  audience: string;
  now?: () => Date;
}

/** Browser/WebView entry point. Native platforms must provide equivalent durable
 * SQLite/fsync adapters rather than treating browser storage as native durability.
 * A lost/cleared IndexedDB database cannot provide tamper-resistant rollback
 * protection: production native clients should anchor sequence in protected storage.
 */
export function createVerifiedBrowserAssetRuntime(options: VerifiedAssetBootstrapOptions) {
  if (!options.pinnedPublicKeys.size) throw new Error('No pinned asset signing keys');
  const fence = indexedDbSequenceFence(options.audience);
  const authority = createSignedAssetAuthority({
    keys: options.pinnedPublicKeys,
    audience: options.audience,
    fence,
    now: options.now,
  });
  return createOfflineAssetRuntime<SignedAssetEnvelope>(authority, indexedDbAssetSlots());
}
