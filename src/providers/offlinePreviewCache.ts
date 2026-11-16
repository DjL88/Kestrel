/**
 * Best-effort, local-only preview storage. Originals never enter this cache.
 * Cache keys include the original's identity and modification metadata so a
 * replaced file cannot inherit an unrelated preview.
 */
const DB = 'kestrel-offline-previews-v1';
const STORE = 'previews';
const MAX_PREVIEW_BYTES = 1024 * 1024;
const MAX_CACHED_PREVIEWS = 1200;

export interface OfflinePreviewPair {
  thumbnail: Blob;
  review: Blob;
}

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
      request.onsuccess = () => {
        const value: unknown = request.result;
        if (value instanceof Blob) resolve(value);
        else if (isOfflinePreviewPair(value)) resolve(value.thumbnail);
        else resolve(null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch { return null; }
  finally { db?.close(); }
}

export async function loadOfflinePreviewPair(key: string): Promise<OfflinePreviewPair | null> {
  if (typeof indexedDB === 'undefined') return null;
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    return await new Promise((resolve, reject) => {
      const request = db!.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => {
        const value: unknown = request.result;
        if (isOfflinePreviewPair(value)) resolve(value);
        else if (value instanceof Blob) resolve({ thumbnail: value, review: value });
        else resolve(null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch { return null; }
  finally { db?.close(); }
}

function isOfflinePreviewPair(value: unknown): value is OfflinePreviewPair {
  if (!value || typeof value !== 'object') return false;
  const pair = value as Partial<OfflinePreviewPair>;
  return pair.thumbnail instanceof Blob && pair.review instanceof Blob;
}

function validPreview(preview: Blob): boolean {
  return preview.type.startsWith('image/') && preview.size > 0 && preview.size <= MAX_PREVIEW_BYTES;
}

async function saveValue(key: string, value: Blob | OfflinePreviewPair): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.put(value, key);
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

export async function saveOfflinePreview(key: string, preview: Blob): Promise<boolean> {
  return validPreview(preview) ? saveValue(key, preview) : false;
}

export async function saveOfflinePreviewPair(key: string, previews: OfflinePreviewPair): Promise<boolean> {
  return validPreview(previews.thumbnail) && validPreview(previews.review) &&
    previews.thumbnail.size + previews.review.size <= MAX_PREVIEW_BYTES
    ? saveValue(key, previews)
    : false;
}

/** Clear only derived preview bytes; never removes originals or catalogue edits. */
export async function clearOfflinePreviews(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return true;
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch { return false; }
  finally { db?.close(); }
}

/** Only exact stable-key matches can be removed; other cached projects remain intact. */
export function previewBelongsToOriginals(cacheKey: string, originalKeys: ReadonlySet<string>): boolean {
  try {
    const identity: unknown = JSON.parse(cacheKey);
    return Array.isArray(identity) && typeof identity[0] === 'string' && originalKeys.has(identity[0]);
  } catch { return false; }
}

/**
 * Purge previews belonging to originals that no remaining project references.
 * The cache is derived data; this never opens or deletes the original files.
 */
export async function deleteOfflinePreviewsForOriginals(originalKeys: ReadonlySet<string>): Promise<boolean> {
  if (originalKeys.size === 0 || typeof indexedDB === 'undefined') return true;
  let db: IDBDatabase | undefined;
  try {
    db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readwrite');
      const cursor = tx.objectStore(STORE).openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        if (previewBelongsToOriginals(String(row.key), originalKeys)) row.delete();
        row.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch { return false; }
  finally { db?.close(); }
}
