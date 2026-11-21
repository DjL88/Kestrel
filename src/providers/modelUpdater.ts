/**
 * Keeps Kestrel's models current without a new app. It never blocks launch and never needs a connection: it asks the
 * models bucket for the signed manifest (at most once a day), checks the signature against the pinned key, refuses an
 * older revision, and installs only same-contract models (`modelUpdatePolicy.ts`) whose size and SHA-256 match the signed
 * list. A bad download leaves the previous model in place. The loaders use an installed model first and the bundled one
 * otherwise, so an offline or failed check changes nothing.
 */
import { dueForDataCheck, type DataAsset } from '../core/dataUpdateManifest';
import { openSignedDataManifest, stageDownloadedAsset, type InstalledAsset } from '../core/modelDelivery';
import { planModelUpdates, type SkippedModel } from '../core/modelUpdatePolicy';
import { parsePinnedKeys } from '../core/licenceOnline';
import { sha256Hex } from '../core/sha256';
import type { PinnedKeys } from '../core/signedEnvelope';
import { getModel, putModel, removeModel } from './modelStore';

const STATE = 'kestrel.models.v1';
const CACHE = 'kestrel-model-updates-v1';

type Stored = InstalledAsset & { bytes: number };
interface State { revision: number; lastSuccessMs: number | null; installed: Record<string, Stored>; previous: Record<string, Stored> }
const EMPTY: State = { revision: 0, lastSuccessMs: null, installed: {}, previous: {} };
const modelKey = (asset: InstalledAsset) => asset.id + '/' + asset.sha256;
// Background network work must not silently download an optional 200+ MiB model.
// Larger files require an explicit check(true) initiated from a user action.
const MAX_BACKGROUND_MODEL_BYTES = 8 * 1024 * 1024;

export interface ModelStoreLike {
  get(key: string): Promise<Blob | undefined>;
  put(key: string, blob: Blob): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface UpdaterOptions {
  /** The models bucket address, or null when this build has none. */
  baseUrl: string | null;
  /** Pinned manifest public keys. Empty means a manifest cannot be trusted, so updates are off. */
  keys: PinnedKeys;
  storage: { getItem(k: string): string | null; setItem(k: string, v: string): void };
  store: ModelStoreLike;
  fetch: typeof fetch;
  now: () => number;
  online: () => boolean;
}

export type UpdateOutcome =
  | { kind: 'off' | 'not_due' | 'offline' }
  | { kind: 'unreachable' }
  | { kind: 'refused'; reason: 'untrusted_manifest' | 'older_revision' }
  | { kind: 'checked'; installed: string[]; skipped: SkippedModel[]; rejected: { id: string; reason: string }[] };

export class ModelUpdater {
  constructor(private readonly o: UpdaterOptions) {}

  get configured() { return this.o.baseUrl !== null && Object.keys(this.o.keys).length > 0; }

  private load(): State {
    try { const parsed = JSON.parse(this.o.storage.getItem(STATE) ?? 'null') as State | null; if (parsed && Number.isSafeInteger(parsed.revision) && parsed.revision >= 0 && parsed.installed && typeof parsed.installed === 'object') return { ...parsed, previous: parsed.previous && typeof parsed.previous === 'object' ? parsed.previous : {} }; } catch { /* damaged: start again */ }
    return { ...EMPTY, installed: {}, previous: {} };
  }
  private save(state: State) { try { this.o.storage.setItem(STATE, JSON.stringify(state)); } catch { /* storage blocked: tries again next launch */ } }

  /** The installed update for a slot, re-checked against its recorded checksum, or null (use the bundled model). */
  async installed(id: string): Promise<{ bytes: ArrayBuffer; sha256: string } | null> {
    const state = this.load();
    // Retain the previous verified model across a process crash, quota failure,
    // corrupted candidate, or incomplete metadata write. Never trust a blob's
    // contents merely because its filename matches the manifest.
    for (const have of [state.installed[id], state.previous[id]]) {
      if (!have || have.id !== id) continue;
      const blob = await this.o.store.get(modelKey(have)).catch(() => undefined);
      if (!blob || blob.size !== have.bytes) continue;
      const bytes = await blob.arrayBuffer();
      if (bytes.byteLength !== have.bytes || await sha256Hex(bytes) !== have.sha256) continue;
      return { bytes, sha256: have.sha256 };
    }
    return null;
  }

  async check(force = false): Promise<UpdateOutcome> {
    if (!this.configured) return { kind: 'off' };
    const state = this.load();
    if (!force && !dueForDataCheck(state.lastSuccessMs, this.o.now(), this.o.online())) return { kind: this.o.online() ? 'not_due' : 'offline' };
    if (!this.o.online()) return { kind: 'offline' };
    let envelope: unknown;
    try {
      const response = await this.o.fetch(`${this.o.baseUrl}/manifest/stable.json`, { cache: 'no-cache', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return { kind: 'unreachable' };
      envelope = await response.json();
    } catch { return { kind: 'unreachable' }; }
    const opened = await openSignedDataManifest(envelope, this.o.keys);
    if (!opened.ok) return { kind: 'refused', reason: 'untrusted_manifest' };
    // A correctly signed but older list could re-offer a model that was withdrawn. Never go back.
    if (opened.manifest.revision < state.revision) return { kind: 'refused', reason: 'older_revision' };

    const plan = planModelUpdates(opened.manifest, state.installed);
    const installed: string[] = [];
    const skipped = [...plan.skipped];
    const rejected: { id: string; reason: string }[] = [];
    for (const asset of plan.install) {
      if (!force && asset.bytes > MAX_BACKGROUND_MODEL_BYTES) {
        skipped.push({ id: asset.id, reason: 'manual_approval_required' });
        continue;
      }
      const old = state.installed[asset.id] ?? null;
      const result = await this.install(asset, old);
      if (result === 'ok') {
        // The old content-addressed blob survives until the replacement has
        // been verified, activated and saved. It remains a usable fallback.
        if (old && old.sha256 !== asset.sha256) state.previous[asset.id] = old;
        state.installed[asset.id] = { id: asset.id, version: asset.version, sha256: asset.sha256, bytes: asset.bytes };
        installed.push(asset.id);
        this.save(state);
      } else rejected.push({ id: asset.id, reason: result });
    }
    state.revision = Math.max(state.revision, opened.manifest.revision);
    // Only a clean pass counts as checked; a rejected download is tried again next launch.
    state.lastSuccessMs = rejected.length ? state.lastSuccessMs : this.o.now();
    this.save(state);
    return { kind: 'checked', installed, skipped, rejected };
  }

  private async install(asset: DataAsset, previous: InstalledAsset | null): Promise<'ok' | string> {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      const response = await this.o.fetch(`${this.o.baseUrl}${asset.path}`, { signal: AbortSignal.timeout(10 * 60_000) });
      if (!response.ok || !response.body) return 'download_failed';
      const declared = Number(response.headers.get('content-length') ?? asset.bytes);
      if (!Number.isFinite(declared) || declared > asset.bytes) return 'size_mismatch';
      // Stream with a strict signed-size ceiling rather than allocating an
      // unbounded Response.arrayBuffer() supplied by a remote object store.
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        length += result.value.byteLength;
        if (length > asset.bytes) { await reader.cancel().catch(() => undefined); return 'size_mismatch'; }
        chunks.push(result.value);
      }
      bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    } catch { return 'download_failed'; }
    const decision = await stageDownloadedAsset(asset, bytes, previous);
    if (decision.action !== 'swap') return decision.reason;
    try { await this.o.store.put(modelKey(asset), new Blob([bytes], { type: 'application/octet-stream' })); } catch { return 'storage_failed'; }
    return 'ok';
  }

  /** Forget every installed update; the loaders go back to the bundled models. */
  async reset(): Promise<void> {
    const state = this.load();
    const keys = new Set<string>();
    for (const asset of [...Object.values(state.installed), ...Object.values(state.previous)]) keys.add(modelKey(asset));
    for (const key of keys) await this.o.store.remove(key).catch(() => undefined);
    this.save({ revision: state.revision, lastSuccessMs: null, installed: {}, previous: {} });
  }
}

/** The models bucket address and pinned manifest key are build settings (public). Without both, updates are off. */
const env = import.meta.env;
function baseUrl(): string | null {
  try {
    const url = new URL(String(env?.VITE_KESTREL_MODEL_BASE_URL ?? '').trim());
    return url.protocol === 'https:' && !url.search && !url.hash && !url.username ? url.origin + url.pathname.replace(/\/+$/, '') : null;
  } catch { return null; }
}

const local = {
  getItem: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k: string, v: string) => { localStorage.setItem(k, v); },
};
export const modelUpdater = new ModelUpdater({
  baseUrl: baseUrl(),
  keys: parsePinnedKeys(env?.VITE_KESTREL_MODEL_KEYS),
  storage: local,
  store: { get: (key) => getModel(CACHE, key), put: (key, blob) => putModel(CACHE, key, blob), remove: (key) => removeModel(CACHE, key) },
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
});

/** Run once when the app opens. Never throws and never delays anything. */
export function startModelUpdates(): void {
  void modelUpdater.check().catch(() => undefined);
}

export const installedModel = (id: string) => modelUpdater.installed(id).catch(() => null);
