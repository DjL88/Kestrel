/**
 * Best-effort, local-only preview storage. Originals never enter this cache.
 * Cache keys include the original's identity and modification metadata so a
 * replaced file cannot inherit an unrelated preview.
 */
const DB = 'kestrel-offline-previews-v1';
const STORE = 'previews';
const MAX_PREVIEW_BYTES = 1024 * 1024;
/**
 * A RAW's own develop may take more: at 2,200 px and JPEG quality 0.82 the CC0 Nikon Z 8 samples (HE, HE*, lossless) and
 * the OM-3 come to 1.02–1.08 MB with their thumbnail, so under 1 MB they lost quality, and a very detailed one size, which
 * the editor then had to replace with a full 45 MP develop. 1.5 MB keeps them whole: at most 3 GB for 2,000 photos.
 */
export const MAX_RAW_DEVELOP_PREVIEW_BYTES = 1.5 * 1024 * 1024;
// Embedded previews and background-developed ones, for shoots of about a thousand photos.
const MAX_CACHED_PREVIEWS = 2400;

export interface OfflinePreviewPair {
  thumbnail: Blob;
  review: Blob;
}

/**
 * Raise when stored previews must be made again. 2: a portrait RAW's embedded preview is now shown upright (nefPreview.ts
 * orientPreview); earlier ones, and pictures developed to match them, were stored sideways.
 */
const PREVIEW_VERSION = 2;

export function previewCacheKey(frame: {
  stableKey: string; filename: string; fileSize?: number; lastModified?: number;
}): string {
  return JSON.stringify([frame.stableKey, frame.filename.toLowerCase(), frame.fileSize ?? null, frame.lastModified ?? null, PREVIEW_VERSION]);
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

function validPreview(preview: Blob, maxBytes = MAX_PREVIEW_BYTES): boolean {
  return preview.type.startsWith('image/') && preview.size > 0 && preview.size <= maxBytes;
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

/** `maxBytes` (thumbnail and review together) is 1 MB, or MAX_RAW_DEVELOP_PREVIEW_BYTES for a RAW's own develop. */
export async function saveOfflinePreviewPair(key: string, previews: OfflinePreviewPair, maxBytes = MAX_PREVIEW_BYTES): Promise<boolean> {
  return previewPairFits(previews, maxBytes) ? saveValue(key, previews) : false;
}

/** Both pictures are images and together within the limit, which is never above MAX_RAW_DEVELOP_PREVIEW_BYTES. */
export function previewPairFits(previews: OfflinePreviewPair, maxBytes = MAX_PREVIEW_BYTES): boolean {
  const limit = Math.min(maxBytes, MAX_RAW_DEVELOP_PREVIEW_BYTES);
  return validPreview(previews.thumbnail, limit) && validPreview(previews.review, limit) &&
    previews.thumbnail.size + previews.review.size <= limit;
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
