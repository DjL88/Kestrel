/**
 * Keeps large downloaded files (models) on this device. Cache Storage is used where the browser offers it. Browsers switch
 * it off on plain http, which is how a phone reaches a development copy over the local network, so a small IndexedDB
 * store is the fallback. Either way a file is kept as a Blob, so it is never copied into memory just to be stored.
 */
const DB = 'kestrel-models';
const STORE = 'files';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Storage is not available.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error('The file could not be stored.'));
    });
  } finally { db.close(); }
}

const hasCaches = () => typeof caches !== 'undefined';

export async function putModel(cacheName: string, key: string, blob: Blob): Promise<void> {
  if (hasCaches()) {
    try { await (await caches.open(cacheName)).put(key, new Response(blob, { headers: { 'content-type': 'application/octet-stream' } })); return; } catch { /* Fall back to the other store. */ }
  }
  await withStore('readwrite', (store) => store.put(blob, `${cacheName}|${key}`));
}

export async function getModel(cacheName: string, key: string): Promise<Blob | undefined> {
  if (hasCaches()) {
    try { const hit = await (await caches.open(cacheName)).match(key); if (hit) return await hit.blob(); } catch { /* Try the other store. */ }
  }
  try { return (await withStore('readonly', (store) => store.get(`${cacheName}|${key}`))) as Blob | undefined; } catch { return undefined; }
}

export async function hasModel(cacheName: string, key: string): Promise<boolean> {
  if (hasCaches()) {
    try { if (await (await caches.open(cacheName)).match(key)) return true; } catch { /* Try the other store. */ }
  }
  try { return (await withStore('readonly', (store) => store.count(`${cacheName}|${key}`))) > 0; } catch { return false; }
}

export async function removeModel(cacheName: string, key: string): Promise<void> {
  if (hasCaches()) { try { await caches.delete(cacheName); } catch { /* Nothing stored there. */ } }
  try { await withStore('readwrite', (store) => store.delete(`${cacheName}|${key}`)); } catch { /* Nothing stored there. */ }
}
