import { useSyncExternalStore } from 'react';
import { parseControlPlaneUrl, parsePinnedKeys } from '../core/licenceOnline';
import type { FlagSet } from '../core/featureFlags';
import { PublicFlags } from './publicFlags';

const SIGNED_IN_KEY = 'kestrel.account-hint.v1';
const BUCKET_KEY = 'kestrel.flag-bucket.v1';

const storage = {
  getItem: (name: string) => { try { return localStorage.getItem(name); } catch { return null; } },
  setItem: (name: string, value: string) => { localStorage.setItem(name, value); },
};

const publicFlags = new PublicFlags({
  baseUrl: parseControlPlaneUrl(import.meta.env?.VITE_KESTREL_CONTROL_PLANE_URL),
  keys: parsePinnedKeys(import.meta.env?.VITE_KESTREL_GRANT_KEYS),
  storage,
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
});

let current: FlagSet | undefined;
const listeners = new Set<() => void>();
const publish = (next: FlagSet | null) => { current = next ?? undefined; listeners.forEach((listener) => listener()); };

/** Use the verified copy kept on this device straight away, then refresh it in the background when it is over a day old. */
export async function loadPublicFlags() {
  publish(await publicFlags.stored());
  publish(await publicFlags.refreshIfDue());
}

export const usePublicFlags = (): FlagSet | undefined =>
  useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => current, () => undefined);

/** A yes or no kept on this device: has this person signed in to an account here. Never an email or a name. */
export const setSignedInHint = (value: boolean) => { try { value ? localStorage.setItem(SIGNED_IN_KEY, '1') : localStorage.removeItem(SIGNED_IN_KEY); } catch { /* optional */ } };
export const signedInHint = () => storage.getItem(SIGNED_IN_KEY) === '1';

/** A random number from 0 to 99 for percentage rollouts. Created once, kept here, and never sent anywhere. */
export function deviceBucket(): number {
  const kept = Number(storage.getItem(BUCKET_KEY));
  if (Number.isInteger(kept) && kept >= 0 && kept <= 99 && storage.getItem(BUCKET_KEY) !== null) return kept;
  const made = Math.min(99, Math.floor(Math.random() * 100));
  try { storage.setItem(BUCKET_KEY, String(made)); } catch { /* the bucket then changes each launch, which only affects trials */ }
  return made;
}
