import { useSyncExternalStore } from 'react';
import { showOnlineHelper, usableProviderSettings, type OnlineHelperAccess } from '../core/onlineHelperAccess';
import type { AiProviderSettings } from './aiProviders';
import { useAiSettings } from './aiSettings';

/**
 * Whether InFlight's own online helper is available to the signed-in account, as the server last said
 * (GET /v1/me/entitlements, read with the plan when signed in and when Settings closes, and by Settings › Account).
 * Kept in memory for this session only, like the plan it comes with: never saved, cleared on sign-out. Not known
 * yet means hidden, and offline means hidden.
 */
let access: OnlineHelperAccess | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function setOnlineHelperAccess(next: OnlineHelperAccess | null): void {
  if (next === access) return;
  access = next;
  notify();
}
export const getOnlineHelperAccess = (): OnlineHelperAccess | null => access;

const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onChange = () => listener();
  if (typeof window !== 'undefined') { window.addEventListener('online', onChange); window.addEventListener('offline', onChange); }
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') { window.removeEventListener('online', onChange); window.removeEventListener('offline', onChange); }
  };
}
const shownNow = () => showOnlineHelper(access, online());

/** True only while the server says the helper is available for this account and the device is online. */
export const useOnlineHelperShown = (): boolean => useSyncExternalStore(subscribe, shownNow, shownNow);

/** The saved AI provider, except a saved InFlight helper while it is hidden: then nothing is sent. */
export function useUsableAiSettings(): AiProviderSettings | null {
  const saved = useAiSettings();
  const shown = useOnlineHelperShown();
  return usableProviderSettings(saved, shown, 'inflight');
}
