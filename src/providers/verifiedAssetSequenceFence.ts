/** Persistent anti-rollback ledger for pinned signed asset catalogues.
 * IndexedDB transaction completion is the only success acknowledgement.
 * No network, photographs, secrets or model execution.
 */
import type { SequenceFence } from '../core/signedAssetAuthority';

const DB_NAME = 'kestrel-verified-asset-sequences';
const STORE = 'manifest-fence';
const VERSION = 1;
const SHA = /^[a-f0-9]{64}$/;
type FenceValue = { sequence: number; digest: string };
const valid = (v: unknown): v is FenceValue =>
  !!v && typeof v === 'object' && Number.isSafeInteger((v as FenceValue).sequence) &&
  (v as FenceValue).sequence >= 1 && SHA.test((v as FenceValue).digest);
const same = (a?: FenceValue, b?: FenceValue) =>
  a === b || (!!a && !!b && a.sequence === b.sequence && a.digest === b.digest);

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Durable asset fence unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Cannot open asset fence'));
    request.onblocked = () => reject(new Error('Asset fence upgrade blocked'));
  });
}

function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Asset fence request failed'));
  });
}

/** Each app/distribution audience has a separate monotonic sequence.
 * CAS uses one readwrite transaction, so concurrent tabs cannot both win.
 * Storage loss must be treated as a trust reset requiring user/app recovery;
 * callers must never silently accept a lower manifest after a storage error.
 */
export function indexedDbSequenceFence(audience: string): SequenceFence {
  if (!/^[a-z][a-z0-9._-]{0,127}$/.test(audience)) throw new Error('Invalid asset audience');
  return {
    async read() {
      const db = await openDatabase();
      try {
        const tx = db.transaction(STORE, 'readonly');
        const value = await readRequest<unknown>(tx.objectStore(STORE).get(audience));
        if (value === undefined) return undefined;
        if (!valid(value)) throw new Error('Corrupt persistent asset fence');
        return { ...value };
      } finally { db.close(); }
    },
    async compareAndSwap(expected, next) {
      if ((expected !== undefined && !valid(expected)) || !valid(next))
        throw new Error('Invalid asset sequence fence update');
      const db = await openDatabase();
      try {
        return await new Promise<boolean>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          const store = tx.objectStore(STORE);
          let changed = false;
          let finished = false;
          const fail = (error: unknown) => {
            if (!finished) { finished = true; reject(error); }
            try { tx.abort(); } catch { /* already closed */ }
          };
          tx.oncomplete = () => { if (!finished) { finished = true; resolve(changed); } };
          tx.onerror = tx.onabort = () => fail(tx.error ?? new Error('Asset fence transaction aborted'));
          readRequest<unknown>(store.get(audience)).then(current => {
            if (current !== undefined && !valid(current)) throw new Error('Corrupt persistent asset fence');
            if (!same(current as FenceValue | undefined, expected)) return;
            if (current && next.sequence < (current as FenceValue).sequence)
              throw new Error('Asset sequence rollback refused');
            if (current && next.sequence === (current as FenceValue).sequence &&
                next.digest !== (current as FenceValue).digest)
              throw new Error('Asset sequence equivocation refused');
            store.put({ ...next }, audience);
            changed = true;
          }).catch(fail);
        });
      } finally { db.close(); }
    },
  };
}
