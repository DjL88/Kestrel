/**
 * Pure planning boundary for a future signed Kite44 data feed.
 * It does not fetch, install or execute files. A transport MUST authenticate
 * the publisher signature before calling parseDataManifest on network input.
 */
export type DataKind = 'equipment' | 'onnx' | 'species-library';
export interface DataAsset {
  id: string;
  kind: DataKind;
  version: string;
  path: string;
  bytes: number;
  sha256: string;
  /** What the model does for the app (inputs, outputs, labels), e.g. `yolox-tiny-coco80-416/v1`. Models only. */
  contract?: string;
}
export interface DataManifest {
  schema: 1;
  revision: number;
  assets: DataAsset[];
}
const ID = /^[a-z][a-z0-9-]{0,63}$/;
const VER = /^[0-9][0-9A-Za-z._-]{0,63}$/;
const SHA = /^[0-9a-f]{64}$/;
const PATH = /^\/data\/[a-zA-Z0-9][a-zA-Z0-9._/-]{0,179}$/;
const CONTRACT = /^[a-z0-9][a-z0-9._-]{0,63}\/v[0-9]{1,3}$/;
const MAX_ASSETS = 80;
const MAX_BYTES = 256 * 1024 * 1024;
const KINDS: DataKind[] = ['equipment', 'onnx', 'species-library'];

function obj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function exact(v: Record<string, unknown>, fields: string[], optional: string[] = []): boolean {
  return Object.keys(v).every((key) => fields.includes(key) || optional.includes(key)) &&
    fields.every((key) => Object.hasOwn(v, key));
}
/** Call ONLY after a publisher signature has been verified against a pinned key. */
export function parseDataManifest(input: unknown): DataManifest | null {
  if (!obj(input) || !exact(input, ['schema', 'revision', 'assets']) ||
      input.schema !== 1 || !Number.isSafeInteger(input.revision) ||
      (input.revision as number) < 1 || !Array.isArray(input.assets) ||
      input.assets.length > MAX_ASSETS) return null;
  const assets: DataAsset[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const v of input.assets) {
    if (!obj(v) || !exact(v, ['id', 'kind', 'version', 'path', 'bytes', 'sha256'], ['contract']) ||
        (v.contract !== undefined && (typeof v.contract !== 'string' || !CONTRACT.test(v.contract))) ||
        typeof v.id !== 'string' || !ID.test(v.id) || ids.has(v.id) ||
        !KINDS.includes(v.kind as DataKind) ||
        typeof v.version !== 'string' || !VER.test(v.version) ||
        typeof v.path !== 'string' || !PATH.test(v.path) ||
        v.path.includes('..') || v.path.includes('//') || paths.has(v.path) ||
        !Number.isSafeInteger(v.bytes) || (v.bytes as number) <= 0 ||
        (v.bytes as number) > MAX_BYTES ||
        typeof v.sha256 !== 'string' || !SHA.test(v.sha256)) return null;
    ids.add(v.id);
    paths.add(v.path);
    assets.push({ id: v.id, kind: v.kind as DataKind, version: v.version,
      path: v.path, bytes: v.bytes as number, sha256: v.sha256,
      ...(v.contract === undefined ? {} : { contract: v.contract as string }) });
  }
  return { schema: 1, revision: input.revision as number, assets };
}

/** Return only changed assets. No update for a stale/identical manifest. */
export function planDataUpdate(
  current: DataManifest,
  candidate: DataManifest,
): DataAsset[] {
  if (candidate.revision <= current.revision) return [];
  const old = new Map(current.assets.map((a) => [a.id, a]));
  return candidate.assets.filter((asset) => {
    const prior = old.get(asset.id);
    return !prior || prior.sha256 !== asset.sha256 || prior.version !== asset.version;
  });
}

/** Rate-limit background checks; never block launch while offline. */
export function dueForDataCheck(lastSuccessMs: number | null, nowMs: number, online: boolean): boolean {
  if (!online || !Number.isFinite(nowMs) || nowMs < 0) return false;
  if (lastSuccessMs === null || !Number.isFinite(lastSuccessMs) || lastSuccessMs > nowMs) return true;
  return nowMs - lastSuccessMs >= 24 * 60 * 60 * 1000;
}
