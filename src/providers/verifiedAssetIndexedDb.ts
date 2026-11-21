/** Crash-durable browser storage for non-executable, signature-approved asset bytes.
 * Separate from modelStore's best-effort Cache Storage: the active pointer and
 * previous known-good pointer MUST share one IndexedDB transaction.
 * No fetch, telemetry or photo access. Native apps require an equivalent fsync adapter.
 */
import type { ActiveAsset, AssetSlots } from '../core/verifiedAssetActivation';

const DB = 'kestrel-verified-assets';
const VERSION = 1;
const FILES = 'immutable-by-sha256';
const POINTERS = 'active-and-previous';
const ID = /^[a-z][a-z0-9._-]{0,127}$/;
const SLOT = /^sha256-[a-f0-9]{64}$/;
interface PointerRecord { active: ActiveAsset; previous?: ActiveAsset }
/** IndexedDB implementations can reject a single value near 128 MiB even with ample free disk.
 * Split large immutable model files into 16 MiB records, all staged in ONE transaction.
 * Small existing entries remain readable, so this is a non-destructive migration. */
const PART_BYTES = 16 * 1024 * 1024;
const MAX_CHUNKED_BYTES = 512 * 1024 * 1024;
interface ChunkedValue { kind: 'kestrel-chunked-v1'; bytes: number; chunks: number }
const chunkKey = (slot: string, part: number) => `${slot}:part:${part}`;
const isChunked = (value: unknown): value is ChunkedValue => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<ChunkedValue>;
  return v.kind === 'kestrel-chunked-v1' &&
    Number.isSafeInteger(v.bytes) && (v.bytes ?? 0) > PART_BYTES && (v.bytes ?? 0) <= MAX_CHUNKED_BYTES &&
    Number.isSafeInteger(v.chunks) && v.chunks === Math.ceil((v.bytes ?? 0) / PART_BYTES);
};
async function readImmutable(store: IDBObjectStore, slot: string): Promise<Uint8Array | undefined> {
  const value: unknown = await requestValue(store.get(slot));
  if (value instanceof Uint8Array) return value.slice(); // legacy small asset
  if (!isChunked(value)) return undefined;
  const joined = new Uint8Array(value.bytes);
  for (let part = 0; part < value.chunks; part += 1) {
    const chunk: unknown = await requestValue(store.get(chunkKey(slot, part)));
    const length = Math.min(PART_BYTES, value.bytes - part * PART_BYTES);
    if (!(chunk instanceof Uint8Array) || chunk.byteLength !== length) return undefined;
    joined.set(chunk, part * PART_BYTES);
  }
  return joined; // caller verifies the pinned SHA-256 before trusting bytes
}
const equal = (a?: ActiveAsset, b?: ActiveAsset) =>
  a === b || (!!a && !!b && a.id === b.id && a.version === b.version &&
    a.sha256 === b.sha256 && a.slot === b.slot);

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Verified asset storage unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
      if (!db.objectStoreNames.contains(POINTERS)) db.createObjectStore(POINTERS);
    };
    request.onerror = () => reject(request.error ?? new Error('Cannot open verified asset storage'));
    request.onblocked = () => reject(new Error('Verified asset storage upgrade blocked'));
    request.onsuccess = () => resolve(request.result);
  });
}
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Verified asset storage request failed'));
  });
}
async function transact<T>(stores: string[], mode: IDBTransactionMode,
  operation: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value: T;
      let settled = false;
      const fail = (error: unknown) => {
        if (!settled) { settled = true; reject(error); }
        try { if (tx.mode === 'readwrite') tx.abort(); } catch { /* already closed */ }
      };
      tx.oncomplete = () => { if (!settled) { settled = true; resolve(value); } };
      tx.onabort = tx.onerror = () => fail(tx.error ?? new Error('Verified asset transaction aborted'));
      operation(tx).then(v => { value = v; }).catch(fail);
    });
  } finally { db.close(); }
}
function valid(asset: ActiveAsset | undefined): asset is ActiveAsset {
  return !!asset && ID.test(asset.id) && SLOT.test(asset.slot) &&
    asset.slot === 'sha256-' + asset.sha256;
}
/** The activation core verifies digest before and after write; this adapter
 * enforces immutability and atomic CAS across concurrent browser tabs. */
export function indexedDbAssetSlots(maxCacheBytes = 4_294_967_296): AssetSlots & {
  previous(id: string): Promise<ActiveAsset | undefined>;
} {
  if (!Number.isSafeInteger(maxCacheBytes) || maxCacheBytes <= 0)
    throw new Error('Invalid verified asset cache budget');
  return {
    async writeImmutable(slot, bytes) {
      if (!SLOT.test(slot) || bytes.byteLength === 0 || bytes.byteLength > MAX_CHUNKED_BYTES)
        throw new Error('Invalid immutable asset slot or excessive single-model size');
      await transact([FILES], 'readwrite', async tx => {
        const store = tx.objectStore(FILES);
        if (await requestValue(store.getKey(slot)) !== undefined) {
          // A crash after staging but before CAS must permit an EXACT retry.
          // If one chunk is missing/corrupt, reject; never reuse incomplete staged bytes.
          const existing = await readImmutable(store, slot);
          if (!existing || existing.byteLength !== bytes.byteLength ||
              existing.some((value, index) => value !== bytes[index]))
            throw new Error('Immutable asset slot collision');
          return;
        }
        // Reserve the entire file budget atomically across tabs and versions.
        // Chunk markers have zero payload bytes; the child byte records are counted.
        const used = await new Promise<number>((resolve, reject) => {
          let total = 0;
          const cursor = store.openCursor();
          cursor.onerror = () => reject(cursor.error ?? new Error('Asset cache scan failed'));
          cursor.onsuccess = () => {
            const entry = cursor.result;
            if (!entry) { resolve(total); return; }
            if (!(entry.value instanceof Uint8Array) && !isChunked(entry.value)) {
              reject(new Error('Malformed immutable asset cache entry')); return;
            }
            if (entry.value instanceof Uint8Array) total += entry.value.byteLength;
            if (!Number.isSafeInteger(total) || total > maxCacheBytes) {
              reject(new Error('Verified asset cache exceeds storage budget')); return;
            }
            entry.continue();
          };
        });
        if (bytes.byteLength > maxCacheBytes - used)
          throw new Error('Verified asset cache exceeds storage budget');
        if (bytes.byteLength <= PART_BYTES) {
          await requestValue(store.add(bytes.slice(), slot));
          return;
        }
        // Store the header and ALL parts within the same IDB transaction, so
        // quota failure, cancellation or a killed tab never leaves an active half-file.
        const chunks = Math.ceil(bytes.byteLength / PART_BYTES);
        await requestValue(store.add({ kind: 'kestrel-chunked-v1', bytes: bytes.byteLength, chunks } satisfies ChunkedValue, slot));
        for (let part = 0; part < chunks; part += 1) {
          const start = part * PART_BYTES;
          await requestValue(store.add(bytes.slice(start, Math.min(start + PART_BYTES, bytes.byteLength)), chunkKey(slot, part)));
        }
      });
    },
    async read(slot) {
      if (!SLOT.test(slot)) return undefined;
      return transact([FILES], 'readonly', tx => readImmutable(tx.objectStore(FILES), slot));
    },
    async active(id) {
      if (!ID.test(id)) return undefined;
      return transact([POINTERS], 'readonly', async tx => {
        const record = await requestValue<PointerRecord | undefined>(tx.objectStore(POINTERS).get(id));
        return valid(record?.active) && record.active.id === id ? record.active : undefined;
      });
    },
    async previous(id) {
      if (!ID.test(id)) return undefined;
      return transact([POINTERS], 'readonly', async tx => {
        const record = await requestValue<PointerRecord | undefined>(tx.objectStore(POINTERS).get(id));
        return valid(record?.previous) && record.previous.id === id ? record.previous : undefined;
      });
    },
    async compareAndSwapActive(id, expected, next) {
      if (!ID.test(id) || !valid(next) || next.id !== id || (expected !== undefined && !valid(expected)))
        throw new Error('Invalid verified asset pointer');
      return transact([FILES, POINTERS], 'readwrite', async tx => {
        const pointers = tx.objectStore(POINTERS);
        const current = await requestValue<PointerRecord | undefined>(pointers.get(id));
        if (!equal(current?.active, expected)) return false;
        if (await requestValue(tx.objectStore(FILES).getKey(next.slot)) === undefined)
          throw new Error('Unstaged asset cannot become active');
        await requestValue(pointers.put({ active: next, previous: current?.active }, id));
        return true;
      });
    },
  };
}
