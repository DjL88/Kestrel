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
export function indexedDbAssetSlots(): AssetSlots & {
  previous(id: string): Promise<ActiveAsset | undefined>;
} {
  return {
    async writeImmutable(slot, bytes) {
      if (!SLOT.test(slot) || bytes.byteLength === 0) throw new Error('Invalid immutable asset slot');
      await transact([FILES], 'readwrite', async tx => {
        const store = tx.objectStore(FILES);
        if (await requestValue(store.getKey(slot)) !== undefined) {
          // A crash after staging but before CAS must permit an exact retry.
          // Same SHA slot with different bytes is a hard collision.
          const existing = await requestValue(store.get(slot));
          if (!(existing instanceof Uint8Array) || existing.byteLength !== bytes.byteLength ||
              existing.some((value, index) => value !== bytes[index]))
            throw new Error('Immutable asset slot collision');
          return;
        }
        await requestValue(store.add(bytes.slice(), slot));
      });
    },
    async read(slot) {
      if (!SLOT.test(slot)) return undefined;
      return transact([FILES], 'readonly', async tx => {
        const value = await requestValue(tx.objectStore(FILES).get(slot));
        return value instanceof Uint8Array ? value.slice() : undefined;
      });
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
