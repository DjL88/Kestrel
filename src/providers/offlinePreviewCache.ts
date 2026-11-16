/**
 * Best-effort, local-only preview storage. Originals never enter this cache.
 * Cache keys include the original's identity and modification metadata so a
 * replaced file cannot inherit an unrelated preview.
 */
const DB = 'kestrel-offline-previews-v1';
const STORE = 'previews';
const MAX_PREVIEW_BYTES = 1024 * 1024;
const MAX_CACHED_PREVIEWS = 1200;

export function previewCacheKey(frame: {
  stableKey: string; filename: string; fileSize?: number; lastModified?: number;
}): string {
  return JSON.stringify([frame.stableKey, frame.filename.toLowerCase(), frame.fileSize ?? null, frame.lastModified ?? null]);
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadOfflinePreview(key: string): Promise<Blob | null> {
  if (typeof indexedDB === 'undefined') return null;
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    return await new Promise((resolve, reject) => {
      const request = db!.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
      request.onerror = () => reject(request.error);
    });
  } catch { return null; }
  finally { db?.close(); }
}

export async function saveOfflinePreview(key: string, preview: Blob): Promise<boolean> {
  if (typeof indexedDB === 'undefined' || !preview.type.startsWith('image/') ||
      preview.size === 0 || preview.size > MAX_PREVIEW_BYTES) return false;
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put(preview, key);
      // Limit entries without touching originals. FIFO by cache key ordering is
      // intentionally avoided: a deterministic bound is better than unlimited growth.
      const count = store.count();
      count.onsuccess = () => {
        if (count.result <= MAX_CACHED_PREVIEWS) return;
        let remaining = count.result - MAX_CACHED_PREVIEWS;
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row || remaining <= 0) return;
          if (row.key !== key) { row.delete(); remaining--; }
          row.continue();
        };
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch { return false; }
  finally { db?.close(); }
}
