import { useSyncExternalStore } from 'react';
import { linkState } from '../core/connectivity';
function snapshot() {
  return linkState(typeof navigator === 'undefined' ? undefined : navigator.onLine);
}
function subscribe(notify: () => void) {
  if (typeof window === 'undefined') return () => {};
  const events = ['online', 'offline', 'focus'] as const;
  events.forEach(event => window.addEventListener(event, notify));
  document.addEventListener('visibilitychange', notify);
  return () => {
    events.forEach(event => window.removeEventListener(event, notify));
    document.removeEventListener('visibilitychange', notify);
  };
}
/** Shared local link detection: no probes, tracking or dependency on a server. */
export function useConnectivity() {
  return useSyncExternalStore(subscribe, snapshot, () => 'unverified' as const);
}
