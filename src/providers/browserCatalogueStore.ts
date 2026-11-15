import {
  DEFAULT_KEY_BINDINGS,
  type KeyBindingsMap,
  type KnobFunction,
} from '../core/keyboardCommands';
import type { CatalogueStore } from '../core/platformBoundaries';
import type { CullingState, WorkspaceViewMode } from '../core/types';

const DB_NAME = 'kestrel-cull-v1';
const DB_VERSION = 1;
const STORE_CATALOGUE = 'catalogue';
const STORE_FILES = 'localFiles';
const STORE_HANDLES = 'directoryHandles';

const ACTIVE_KEY = 'active-shoot-state';
const PREFS_STORAGE_KEY = 'kestrel.preferences.v1';

export interface UserPreferences {
  viewMode: WorkspaceViewMode;
  showShortcutsOverlay: boolean;
  bindings: KeyBindingsMap;
  knobMode: KnobFunction;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  viewMode: 'loupe',
  showShortcutsOverlay: true,
  bindings: DEFAULT_KEY_BINDINGS,
  knobMode: 'navigate',
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CATALOGUE)) {
        db.createObjectStore(STORE_CATALOGUE);
      }
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES);
      }
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        db.createObjectStore(STORE_HANDLES);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet<T>(storeName: string, key: string): Promise<T | null> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet<T>(storeName: string, key: string, value: T): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Graceful no-op if storage quota exceeded
  }
}

async function idbDeleteStore(storeName: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // ignore
  }
}

export function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    return {
      viewMode: parsed.viewMode ?? DEFAULT_PREFERENCES.viewMode,
      showShortcutsOverlay:
        parsed.showShortcutsOverlay ?? DEFAULT_PREFERENCES.showShortcutsOverlay,
      knobMode: parsed.knobMode ?? DEFAULT_PREFERENCES.knobMode,
      bindings: {
        ...DEFAULT_KEY_BINDINGS,
        ...(parsed.bindings ?? {}),
      },
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(prefs: UserPreferences): void {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota errors
  }
}

export class BrowserCatalogueStore implements CatalogueStore {
  async loadActiveState(): Promise<Partial<CullingState> | null> {
    const idbState = await idbGet<CullingState>(STORE_CATALOGUE, ACTIVE_KEY);

    let lsState: CullingState | null = null;
    try {
      const raw = localStorage.getItem('kestrel.activeStateFallback.v1');
      if (raw) lsState = JSON.parse(raw) as CullingState;
    } catch {
      lsState = null;
    }

    if (idbState && lsState) {
      const idbTs = idbState.shoot?.lastUpdatedAt ?? 0;
      const lsTs = lsState.shoot?.lastUpdatedAt ?? 0;
      return lsTs > idbTs ? lsState : idbState;
    }

    return idbState ?? lsState ?? null;
  }

  async saveCullingState(state: CullingState): Promise<void> {
    try {
      // Flush compact metadata synchronously first so instant Cmd+R / tab close never drops the last keypress
      const serialized = JSON.stringify(state);
      if (serialized.length < 2_500_000) {
        localStorage.setItem('kestrel.activeStateFallback.v1', serialized);
      }
    } catch {
      // ignore localStorage overflow on huge shoots
    }
    await idbSet(STORE_CATALOGUE, ACTIVE_KEY, state);
  }

  async saveLocalFileBlob(stableKey: string, file: Blob): Promise<boolean> {
    try {
      // Guard against blowing browser IndexedDB quota on gigantic batches
      if (file.size > 35 * 1024 * 1024) return false;
      await idbSet(STORE_FILES, stableKey, file);
      return true;
    } catch {
      return false;
    }
  }

  async loadLocalFileBlob(stableKey: string): Promise<Blob | null> {
    return idbGet<Blob>(STORE_FILES, stableKey);
  }

  async clearLocalFileBlobs(): Promise<void> {
    await idbDeleteStore(STORE_FILES);
  }

  async saveDirectoryHandle(
    shootId: string,
    handle: FileSystemDirectoryHandle
  ): Promise<void> {
    await idbSet(STORE_HANDLES, shootId, handle);
  }

  async loadDirectoryHandle(
    shootId: string
  ): Promise<FileSystemDirectoryHandle | null> {
    return idbGet<FileSystemDirectoryHandle>(STORE_HANDLES, shootId);
  }

  async clearAll(): Promise<void> {
    await idbDeleteStore(STORE_CATALOGUE);
    await idbDeleteStore(STORE_FILES);
    await idbDeleteStore(STORE_HANDLES);
    try {
      localStorage.removeItem('kestrel.activeStateFallback.v1');
    } catch {
      // ignore
    }
  }
}
