import type { CollabClient } from '../../../providers/collabClient';

const CACHE = 'inflight-cloud-originals-v1';
const ASK_KEY = 'inflight.cloudOriginal.dontAsk.v1';

/** 15 credits per GB downloaded (1 credit = 1p), to one decimal place, shown before anything is fetched. */
export const creditsFor = (bytes: number) => Math.ceil(bytes * 15 / 1e9 * 10) / 10;

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The owner's original from a shared project's cloud store. Each device downloads it once: later requests come from this
 * device's own cache and cost nothing. The download is checked against the stored fingerprint by the client.
 */
export async function fetchCloudOriginal(client: CollabClient, projectId: string, photoKey: string, name: string): Promise<{ file: File; sha256: string }> {
  const cache = typeof caches !== 'undefined' ? await caches.open(CACHE).catch(() => null) : null;
  const request = new Request(`https://inflight.invalid/originals/${encodeURIComponent(projectId)}/${encodeURIComponent(photoKey)}`);
  let blob = cache ? await (await cache.match(request).catch(() => undefined))?.blob() : undefined;
  if (!blob) {
    blob = await client.cloudDownload(projectId, photoKey, 'original');
    await cache?.put(request, new Response(blob)).catch(() => undefined);
  }
  return { file: new File([blob], name, { type: blob.type || 'application/octet-stream', lastModified: 0 }), sha256: await sha256Hex(blob) };
}

/** "Don't ask again" for fetching originals when zooming in, kept on this device only. */
export function dontAskAgain(): boolean { try { return localStorage.getItem(ASK_KEY) === '1'; } catch { return false; } }
export function setDontAskAgain(value: boolean) { try { if (value) localStorage.setItem(ASK_KEY, '1'); else localStorage.removeItem(ASK_KEY); } catch { /* private window: asks each time */ } }
