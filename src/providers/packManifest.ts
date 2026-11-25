import type { DataManifest } from '../core/dataUpdateManifest';
import { openSignedDataManifest } from '../core/modelDelivery';
import { packFileUrlFromManifest, type OptionalModel } from '../core/optionalModels';
import type { PinnedKeys } from '../core/signedEnvelope';

/**
 * Finds where to download a pack file: in the one signed model manifest (the models bucket's manifest/stable.json, key
 * kestrel-2026-11). Called only when the photographer downloads a pack, never in the background, so a build stays
 * silent on the network until someone asks. The manifest is verified against the pinned key, then the address is used
 * only for the asset whose SHA-256 and size are the ones pinned in the app; the download itself is checked again
 * byte for byte (providers/optionalModels.ts).
 */
export type PackUrlResolver = (model: OptionalModel, role: string) => Promise<string>;

export function packUrlResolver(source: { baseUrl: string | null; keys: PinnedKeys; fetch: typeof fetch }): PackUrlResolver {
  let manifest: Promise<DataManifest> | null = null;
  const load = (base: string) => (manifest ??= (async () => {
    const response = await source.fetch(`${base}/manifest/stable.json`, { cache: 'no-cache', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('The list of models could not be read. Check the connection and try again.');
    const checked = await openSignedDataManifest(await response.json(), source.keys);
    if (!checked.ok) throw new Error('The list of models did not pass its signature check, so nothing was downloaded.');
    return checked.manifest;
  })().catch((error: unknown) => { manifest = null; throw error; }));

  return async (model, role) => {
    if (!source.baseUrl || !Object.keys(source.keys).length) throw new Error(`${model.name} is not offered in this copy of InFlight.`);
    const url = packFileUrlFromManifest(model, role, await load(source.baseUrl), source.baseUrl);
    if (!url) throw new Error(`${model.name} is not in the list of models yet. Try again later.`);
    return url;
  };
}
