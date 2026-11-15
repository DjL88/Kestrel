import { computeCullCounts } from '../core/cullingEngine';
import { projectSearchText } from '../core/projects';
import {
  DEFAULT_KEY_BINDINGS,
  type KeyBindingsMap,
  type KnobFunction,
} from '../core/keyboardCommands';
import { unreferencedBlobKeys } from '../core/projects';
import type { CatalogueStore } from '../core/platformBoundaries';
import type { CullingState, ShootDescriptor, WorkspaceViewMode } from '../core/types';

const DB_NAME = 'kestrel-cull-v1';
const DB_VERSION = 1;
const STORE_CATALOGUE = 'catalogue';
const STORE_FILES = 'localFiles';
const STORE_HANDLES = 'directoryHandles';

const PROJECT_PREFIX = 'project:';
const ACTIVE_KEY = 'active-shoot-state';
// A deletion means the catalogue has been deliberately managed. Never migrate
// an obsolete active-state fallback into an empty catalogue after that.
const LEGACY_MIGRATION_BLOCKED = 'legacy-migration-blocked-after-delete';
const PREFS_STORAGE_KEY = 'kestrel.preferences.v1';

export interface UserPreferences {
  viewMode: WorkspaceViewMode;
  showShortcutsOverlay: boolean;
  bindings: KeyBindingsMap;
  knobMode: KnobFunction;
  showFilmstrip: boolean;
  focusMode: boolean;
  editPanelSide: 'left' | 'right';
}

/** A phone starts without the filmstrip, so the photo gets the room. It can be pinned from the bar under the photo. */
const smallScreen = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches === true;

export const DEFAULT_PREFERENCES: UserPreferences = {
  viewMode: 'loupe',
  showShortcutsOverlay: false,
  bindings: DEFAULT_KEY_BINDINGS,
  knobMode: 'navigate',
  showFilmstrip: true,
  focusMode: false,
  editPanelSide: 'right',
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
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    const connection = db;
    return await new Promise((resolve, reject) => {
      const request = connection.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

async function idbSet<T>(storeName: string, key: string, value: T): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Catalogue write was interrupted'));
      tx.objectStore(storeName).put(value, key);
    });
  } finally {
    db.close();
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
    if (!raw) return { ...DEFAULT_PREFERENCES, showFilmstrip: !smallScreen() };
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    const bindings = { ...DEFAULT_KEY_BINDINGS, ...parsed.bindings };
    if (bindings['edit.prevControl'] === 'Tab') bindings['edit.prevControl'] = DEFAULT_KEY_BINDINGS['edit.prevControl'];
    return {
      viewMode: parsed.viewMode ?? DEFAULT_PREFERENCES.viewMode,
      showShortcutsOverlay:
        parsed.showShortcutsOverlay ?? DEFAULT_PREFERENCES.showShortcutsOverlay,
      knobMode: parsed.knobMode ?? DEFAULT_PREFERENCES.knobMode,
      showFilmstrip: parsed.showFilmstrip ?? !smallScreen(),
      focusMode: parsed.focusMode ?? DEFAULT_PREFERENCES.focusMode,
      editPanelSide: parsed.editPanelSide === 'left' ? 'left' : 'right',
      bindings,
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
  private projectWrite = Promise.resolve();

  async listProjects(): Promise<ShootDescriptor[]> {
    await this.projectWrite;
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const range = IDBKeyRange.bound(PROJECT_PREFIX, `${PROJECT_PREFIX}\uffff`);
        const cursor = db.transaction(STORE_CATALOGUE).objectStore(STORE_CATALOGUE).openCursor(range);
        const projects: ShootDescriptor[] = [];
        cursor.onerror = () => reject(cursor.error);
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) {
            resolve(projects.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt));
            return;
          }
          const state = row.value as CullingState;
          if (state?.shoot) {
            projects.push({ ...state.shoot, totalFrames: computeCullCounts(state.frames).all });
          }
          row.continue();
        };
      });
    } finally {
      db.close();
    }
  }

  /** Searchable text for each project's photos, so the home page can find a project by what is inside it. */
  async searchIndex(): Promise<Record<string, string>> {
    const states = await this.allProjectStates();
    return Object.fromEntries(states.map((state) => [state.shoot.id, projectSearchText(state.frames)]));
  }

  async loadProject(id: string): Promise<CullingState | null> {
    await this.projectWrite;
    return idbGet<CullingState>(STORE_CATALOGUE, PROJECT_PREFIX + id);
  }

  saveProject(state: CullingState): Promise<void> {
    return this.saveProjects([state]);
  }

  /** Commit all project records together when transferring photos between them. */
  saveProjects(states: readonly CullingState[]): Promise<void> {
    const write = this.projectWrite.then(async () => {
      const db = await openDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_CATALOGUE, 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error ?? new Error('Catalogue write was interrupted'));
          const catalogue = tx.objectStore(STORE_CATALOGUE);
          try {
            for (const state of states) catalogue.put(state, PROJECT_PREFIX + state.shoot.id);
          } catch (error) {
            tx.abort();
            reject(error);
          }
        });
      } finally {
        db.close();
      }
    });
    this.projectWrite = write.catch(() => {});
    return write;
  }

  /** Every project's state, for checking which stored photo copies are shared. */
  private async allProjectStates(): Promise<CullingState[]> {
    const ids = (await this.listProjects()).map((project) => project.id);
    const states = await Promise.all(ids.map((id) => this.loadProject(id)));
    return states.filter((state): state is CullingState => !!state);
  }

  /**
   * Remove a project's catalogue from this browser, and free the stored copies of photos nothing else uses.
   * Files on the user's disk are never touched.
   */
  async deleteProject(id: string): Promise<void> {
    const write = this.projectWrite.then(async () => {
      const db = await openDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction([STORE_CATALOGUE, STORE_FILES, STORE_HANDLES], 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error ?? new Error('Deleting the project was interrupted'));
          const catalogue = tx.objectStore(STORE_CATALOGUE);
          const projectKey = PROJECT_PREFIX + id;
          const request = catalogue.get(projectKey);
          request.onsuccess = () => {
            const project = request.result as CullingState | undefined;
            if (!project) return;
            // Read references under the same write lock as deletion. A restore or
            // transfer in another tab must not make a pre-deletion snapshot stale.
            const keys = new Set(unreferencedBlobKeys(project, []));
            const range = IDBKeyRange.bound(PROJECT_PREFIX, `${PROJECT_PREFIX}\uffff`);
            const cursor = catalogue.openCursor(range);
            cursor.onsuccess = () => {
              const row = cursor.result;
              if (row) {
                if (row.key !== projectKey) {
                  const other = row.value as CullingState;
                  for (const frame of other.frames) keys.delete(frame.stableKey);
                }
                row.continue();
                return;
              }
              catalogue.delete(projectKey);
              // Commit recovery cleanup with deletion, including on a crash.
              catalogue.put(true, LEGACY_MIGRATION_BLOCKED);
              catalogue.delete(ACTIVE_KEY);
              tx.objectStore(STORE_HANDLES).delete(id);
              for (const key of keys) tx.objectStore(STORE_FILES).delete(key);
            };
          };
        });
      } finally {
        db.close();
      }
    });
    this.projectWrite = write.catch(() => {});
    await write;
    try {
      const legacy = localStorage.getItem('kestrel.activeStateFallback.v1');
      if (legacy) {
        const parsed: unknown = JSON.parse(legacy);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
          'shoot' in parsed && (parsed as { shoot?: { id?: string } }).shoot?.id === id) {
          localStorage.removeItem('kestrel.activeStateFallback.v1');
        }
      }
    } catch { /* The atomic catalogue marker still prevents resurrection. */ }
  }

  async loadActiveState(): Promise<Partial<CullingState> | null> {
    if (await idbGet<boolean>(STORE_CATALOGUE, LEGACY_MIGRATION_BLOCKED)) return null;
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
