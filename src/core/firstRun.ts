/**
 * First-run welcome (PRODUCT-SPEC §3.1): shown once, then never again on this device. Pure so it can be unit-tested;
 * the caller passes the storage (window.localStorage in the app). A private window that refuses storage still shows
 * the welcome, and dismissing it there lasts for that visit only.
 */
export const WELCOME_SEEN_KEY = 'inflight.welcome.seen';

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

export function welcomeSeen(storage: KeyValueStore | null | undefined): boolean {
  try { return storage?.getItem(WELCOME_SEEN_KEY) === '1'; } catch { return false; }
}

/** Remembers that the person has read the welcome. Returns false when storage refused it. */
export function markWelcomeSeen(storage: KeyValueStore | null | undefined): boolean {
  try {
    if (!storage) return false;
    storage.setItem(WELCOME_SEEN_KEY, '1');
    return true;
  } catch {
    return false;
  }
}
