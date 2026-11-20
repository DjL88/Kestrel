/**
 * Photographer-owned raster artwork. This IndexedDB store is separate from
 * projects, export presets, sync data and cloud backups. No network calls.
 * Presets retain only the SHA-256 asset ID, never the artwork's base64 bytes.
 */
const DATABASE = 'kestrel-local-watermarks-v1';
const STORE = 'assets';
const MAX_BYTES = 3_000_000;
const MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const isWatermarkAssetId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function hasSignature(bytes: Uint8Array, type: string): boolean {
  if (type === 'image/png') return bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  if (type === 'image/jpeg') return bytes.length >= 3 &&
    bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === 'image/webp') return bytes.length >= 12 &&
    [82, 73, 70, 70].every((v, i) => bytes[i] === v) &&
    [87, 69, 66, 80].every((v, i) => bytes[8 + i] === v);
  return false;
}
async function validateRaster(blob: Blob): Promise<void> {
  if (!(blob instanceof Blob) || blob.size === 0 || blob.size > MAX_BYTES || !MIME.has(blob.type) ||
      !hasSignature(new Uint8Array(await blob.slice(0, 16).arrayBuffer()), blob.type)) {
    throw new Error('Choose a PNG, JPEG or WebP image under 3 MB. This image cannot be used as a watermark.');
  }
}
async function sha256(blob: Blob): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) throw new Error('Secure local image storage is unavailable on this device.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface WatermarkAssetStorage {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | null>;
}

/** Injected backend makes the same safety rules executable without IndexedDB. */
export function createWatermarkAssetRepository(storage: WatermarkAssetStorage) {
  return {
    async save(blob: Blob): Promise<string> {
      await validateRaster(blob);
      const id = await sha256(blob);
      await storage.put(id, blob);
      return id;
    },
    async load(id: string): Promise<Blob | null> {
      if (!isWatermarkAssetId(id)) return null;
      const blob = await storage.get(id);
      if (!blob) return null;
      await validateRaster(blob);
      if (await sha256(blob) !== id) throw new Error('The saved watermark changed. Choose the original image again.');
      return blob;
    },
  };
}

function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Private local storage is not available.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local watermark storage.'));
  });
}

const browserStorage: WatermarkAssetStorage = {
  async put(id, blob) {
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  },
  async get(id) {
    const db = await database();
    try {
      return await new Promise<Blob | null>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const request = tx.objectStore(STORE).get(id);
        request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  },
};

const local = createWatermarkAssetRepository(browserStorage);
export const saveLocalWatermarkAsset = (blob: Blob) => local.save(blob);
export const loadLocalWatermarkAsset = (id: string) => local.load(id);

/** The data URL is *transient* and belongs in the active renderer only. */
export function watermarkBlobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the selected watermark.'));
    reader.readAsDataURL(blob);
  });
}

/** Migrate a historic inline watermark without fetching a network resource. */
export function legacyWatermarkBlob(src: string): Blob {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
  if (!match || src.length > 4_000_024) throw new Error('The previous watermark is not a valid local raster image.');
  const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
  return new Blob([bytes], { type: 'image/' + match[1] });
}
