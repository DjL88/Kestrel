/**
 * Web only (PRODUCT-SPEC §3.1, §6): ask the browser to keep InFlight's storage, so routine clean-up does not remove
 * projects, decisions and previews. The browser decides; InFlight reports what it said and never claims more.
 * The desktop and phone apps keep their data in the app's own folder and are never asked.
 */
export type BrowserStorageState = 'checking' | 'standard' | 'requesting' | 'persistent' | 'declined' | 'unavailable';

/** The part of navigator.storage this needs, so tests can pass a fake. */
export interface PersistentStorageApi {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

const supported = (storage: PersistentStorageApi | null | undefined): storage is Required<PersistentStorageApi> =>
  typeof storage?.persisted === 'function' && typeof storage.persist === 'function';

/** What the browser says now, without asking for anything. */
export async function readBrowserStorage(storage: PersistentStorageApi | null | undefined): Promise<BrowserStorageState> {
  if (!supported(storage)) return 'unavailable';
  try { return await storage.persisted() ? 'persistent' : 'standard'; } catch { return 'unavailable'; }
}

/** Asks once. Already-kept storage is not asked again. */
export async function requestBrowserStorage(storage: PersistentStorageApi | null | undefined): Promise<BrowserStorageState> {
  if (!supported(storage)) return 'unavailable';
  try {
    if (await storage.persisted()) return 'persistent';
    return await storage.persist() ? 'persistent' : 'declined';
  } catch {
    return 'unavailable';
  }
}

/** A request is offered while the browser has not agreed yet and could still be asked. */
export const canAskBrowser = (state: BrowserStorageState) => state === 'standard' || state === 'declined';
